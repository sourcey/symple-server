var http = require('http')
  , https = require('https')
  , sio = require('socket.io')  
  , fs = require('fs')
  //, RedisStore = sio.RedisStore;

//
// Load configuration file
var config = JSON.parse(
  fs.readFileSync(__dirname + "/config.json").toString().replace(
    new RegExp("\\/\\*(.|\\r|\\n)*?\\*\\/", "g"),
    "" // strip out comments
  )
);

//
// Create server instance
var server = (config.ssl && config.ssl.enabled ?
  // HTTPS
  https.createServer({
      key: fs.readFileSync(config.ssl.key)
    , cert: fs.readFileSync(config.ssl.cert)
  }) :
  // HTTP
  http.createServer())  
    .listen(config.port, function() {
      var addr = server.address();
      console.log('Symple server listening on ' + (config.ssl && config.ssl.enabled ? 'https' : 'http')  + '://' + addr.address + ':' + addr.port);
    });


var io = sio.listen(server);

//
// Socket.IO Configuration
io.configure(function () {

  if (config.redis) {
  
    // Initialize the redis store
    var store = new RedisStore({
      nodeID: config.nodeId     || 1,
      redisPub: config.redis    || {},
      redisSub: config.redis    || {},
      redisClient: config.redis || {}
    });
      
    // Authenticate redis connections if required
    if (config.redis && config.redis.password) {
      store.pub.auth(config.redis.password)
      store.sub.auth(config.redis.password)
      store.cmd.auth(config.redis.password)
    }
    
    io.set('store', store); 
  }
});


//
// Globals
//

function isfunc(obj) {
  return !!(obj && obj.constructor && obj.call && obj.apply);
}

function respond(ack, status, message, data) {
  if (ack && isfunc(ack)) {
    res = {}
    res.type = 'response';
    res.status = status;
    res.message = message;
    if (data)
      res.data = data.data ? data.data : data;
    console.log('Responding: ', res);    
    ack(res);
  }
}

// Parses a Symple endpoint address with the following 
// format: user@group/id
function parseAddress(str) {
    var addr = {}, base,
        arr = str.split("/")
        
    if (arr.length < 2) // no id
        base = str;        
    else { // has id
        addr.id = arr[1];   
        base = arr[0];   
    }
    
    arr = base.split("@")
    if (arr.length < 2) // group only
        addr.group = base;         
    else { // group and user
        addr.user = arr[0];
        addr.group  = arr[1];
    }
        
    return addr;
}

function buildAddress(peer) {
    return peer.user + "@" + peer.group + "/" + peer.id;
}


//
// Socket.IO Socket extensions
//

sio.Socket.prototype.authorize = function(req, fn) {  
    
  var client = this;
  
  // Authenticated Access
  if (!config.anonymous) {
    if (!req.user || !req.token)
      return fn(400, 'Bad request');
    
    // Retreive the session from Redis
    client.token = req.token;                 // Remote session token
    client.getSession(function(err, session) {
      //console.log('Authenticating: ', req.token, ':', session);
      if (err || typeof session !== 'object' || typeof session.user !== 'object') {
        //console.log('Authentication error: ', req.token, ':', err);
        return fn(401, 'Authentication failed');
      }
      else {
        //console.log('Authentication success: ', req);        
        client.session = session;             // Remote session object
        client.group = session.user.group;    // The client's parent group
        client.access = session.user.access;  // The client access level [1 - 10]
        client.user = session.user.user;      // The client login name
        client.user_id = session.user.user_id;// The client login user ID
        client.onAuthorize(req);
        return fn(200, 'Welcome ' + client.name);
      }
    });
  }
  
  // Anonymous Access
  else {
    if (!req.user)
      return fn(400, 'Bad request');
      
    client.access = -1;
    client.name = req.name;
    client.group = req.group;
    client.user = req.user;
    client.user_id = req.user_id;
    client.onAuthorize(req);
    return fn(200, 'Welcome ' + client.name);
  }
}


sio.Socket.prototype.onAuthorize = function(req) {
  console.log(this.id, 'on authorize: ', req);
  this.online = true;
  this.name = req.name ?                // The client display name
      req.name : this.user;
  this.type = req.type;                 // The client type
  this.join('user-' + this.user);       // join user channel
  this.join('group-' + this.group);     // join group channel
}


sio.Socket.prototype.toPresence = function(p) {
  if (!p || typeof p !== 'object')
    p = {};
  p.type = 'presence';
  p.data = this.toPeer(p.data);  
  if (!p.from)
    p.from = this.toAddress();
  //if (!p.from || typeof p.from !== 'object') {
  //  p.from = {};
  //  p.from.name = this.name;
  //}
  return p;
}


sio.Socket.prototype.toPeer = function(p) {
  if (!p || typeof p !== 'object')
    p = {};
  p.id = this.id; //sympleID;
  p.type = this.type;
  p.node = this.node;
  p.user = this.user;
  p.user_id = this.user_id;
  p.group = this.group;
  p.access = this.access;
  p.online = this.online;
  p.host = this.handshake.headers['x-real-ip'] 
    || this.handshake.headers['x-forwarded-for'] 
    || this.handshake.address.address; //this.handshake ?  : '';

  // allow client to change name
  if (typeof p.name === 'string')
    this.name = p.name;
  else
    p.name = this.name;

  return p;
}


sio.Socket.prototype.toAddress = function() {
  return this.user + "@" + this.group + "/" + this.id;
}


sio.Socket.prototype.getSessionKey = function(fn) {
  // token must be set
  io.store.cmd.keys("symple:*:" + this.token, function(err, keys) {
    fn(err, keys.length ? keys[0] : null)
  });  
}


sio.Socket.prototype.getSession = function(fn) {
  this.getSessionKey(function(err, key) {
    if (key) {
      io.store.cmd.get(key, function(err, session) {
        fn(err, JSON.parse(session));
      });
    }
    else fn("No session", null);
  });
}


sio.Socket.prototype.touchSession = function(fn) { 
  this.getSessionKey(function(err, key) {
    if (key) {
      // expire in 15 mins
      io.store.cmd.expire(key, 15 * 60, fn);
    }
    else fn("No session", null);
  });
}

sio.Socket.prototype.getDestinationAddress = function(message) {
  switch(typeof message.to) {
    case 'object': 
      return message.to;  
    case 'string':
      return parseAddress(message.to);     
    case 'undefined': 
      return { group: this.group };
  }
}


sio.Socket.prototype.broadcastMessage = function(message) {
  if (!message || typeof message !== 'object' || !message.from) {
    console.error(this.id, 'dropping invalid message:', message);
    return;
  }

  // Replace from address with server-side peer data for security.
  //message.from.id = this.id;
  //message.from.type = this.type;
  //message.from.group = this.group;
  //message.from.access = this.access;
  //message.from.user = this.user;
  //message.from.user_id = this.user_id;
  
  // Get an destination address object for routing  
  var to = this.getDestinationAddress(message);
    
  // Make sure we have a valid destination address
  if (typeof to !== 'object' || typeof to.group === 'undefined') {
    console.error(this.id, 'dropping invalid message without destination:', to, ':', message);
    return;
  }
  
  // If a session id was given we send a directed message to that session id.  
  if (typeof to.id === 'string' && to.id.length) {
    this.namespace/*.except(this.unauthorizedIDs())*/.socket(to.id).json.send(message);
  }
  
  // If a user was given (but no session id) we broadcast a message to user scope.
  // TODO: Ensure group membership
  else if (to.user && typeof to.user === 'string') {
    this.broadcast.to('user-' + to.user/*, this.unauthorizedIDs()*/).json.send(message);
  }
  
  // If a group was given (but no session id or user) we broadcast to group scope.
  else if (to.group && typeof to.group === 'string') {
    this.broadcast.to('group-' + to.group/*, this.unauthorizedIDs()*/).json.send(message);
  }
  
  else {
    console.error(this.id, 'cannot route invalid message:', message);
  }
}


//
// Socket.IO connection handler
//

io.sockets.on('connection', function(client) {    

  // 5 seconds to Announce or get booted
  var interval = setInterval(function () {
      console.log(client.id, 'failed to announce'); 
      client.disconnect();
  }, 5000);

  // Announce
  client.on('announce', function(req, ack) {    
    console.log(client.id, 'announcing:', req);

    try {

      // Authorization
      client.authorize(req, function(status, message) {
        // console.log(client.id, 'announce result:', status);
        clearInterval(interval);
        if (status == 200)
          respond(ack, status, message, client.toPeer());
        else {
          respond(ack, status, message);
          client.disconnect();
          return;
        }

        // Message
        client.on('message', function(m, ack) {
          if (m) {
            if (m.type == 'presence')
              this.toPresence(m);
            client.broadcastMessage(m);
            respond(ack, 200, 'Message received');
          }
        });

        // Peers
        client.on('peers', function(ack) {
          respond(ack, 200, '', this.peers(false));
        });

        // Timer
        if (config.redis) {
          // Keep sessions from expiring while connected
          interval = setInterval(function () {
            // Touch the client session event 10
            // minutes to prevent it from expiring.
            client.touchSession(function(err, res) {
              console.log(client.id, 'touching session:', !!res);
            });
          }, 10 * 60000);
        }

      });
    }
    catch (e) {
        console.log(client.id, 'internal error: ', e);
        client.disconnect();
    }
  }); 

  //
  // Disconnection
  client.on('disconnect', function() {
    console.log(client.id, 'is disconnecting');
    clearInterval(interval);
    if (client.online) {
      client.online = false;
      var p = client.toPresence();
      //console.log('Disconnecting', p);
      client.broadcastMessage(p);
    }
    client.leave('user-' + client.user);    // leave user channel
    client.leave('group-' + client.group);  // leave group channel
  });
});


//
// Socket.IO Manager extensions
//

//sio.Socket.prototype.authorizedClients = function() {
//  var res = [];
//  var clients = io.sockets.clients(this.group);
//  for (i = 0; i < clients.length; i++) {
//    if (clients[i].access >= this.access)
//      res.push(clients[i]);
//  }
//  return res;
//}


// Returns an array of authorized peers belonging to the currect
// client socket group.
//sio.Socket.prototype.peers = function(includeSelf) {
//  res = []
//  //var clients = this.authorizedClients();
//  var clients = io.sockets.clients('group-' + this.group);
//  for (i = 0; i < clients.length; i++) {
//    if ((!includeSelf && clients[i] == this) ||
//            clients[i].access > this.access)
//      continue;
//    res.push(clients[i].toPeer());
//  }
//  return res;
//}


// Returns an array of group peer IDs that dont have permission
// to receive messages broadcast by the current peer ie. access
// is lower than the current peer.
//sio.Socket.prototype.unauthorizedIDs = function() {
//  var res = [];
//  var clients = io.sockets.clients('group-' + this.group);
//  for (i = 0; i < clients.length; i++) {
//    if (clients[i].access < this.access)
//      res.push(clients[i].id);
//  }
//  console.log('Unauthorized IDs:', this.name, ':', this.access, ':', res);
//  return res;
//}

//function packetSender(packet) {
//  var res = packet.match(/\"from\"[ :]+[ {]+[^}]*\"id\"[ :]+\"(.*?)\"/);
//  return res ? io.sockets.sockets[res[1]] : null;
//}

//onDispatchOriginal = sio.Manager.prototype.onDispatch;
//sio.Manager.prototype.onDispatch = function(room, packet, volatile, exceptions) {
//
//  // Authorise outgoing messages via the onDispatch method so unprotected
//  // data can not be published directly from Redis.
//  var sender = packetSender(packet);
//  if (sender) {
//    if (!exceptions)
//      exceptions = [sender.id]; // dont send to self
//    exceptions = exceptions.concat(sender.unauthorizedIDs());
//    //console.log("Sending a message excluding: ", exceptions, ': ', sender.unauthorizedIDs());
//    onDispatchOriginal.call(this, room, packet, volatile, exceptions)
//  }
//}

//onClientDispatchOriginal = sio.Manager.prototype.onClientDispatch;
//sio.Manager.prototype.onClientDispatch = function (id, packet) {
//    
//  // Ensure the recipient has sufficient permission to recieve the message
//  var sender = packetSender(packet);
//  var recipient = io.sockets.sockets[id];
//  if (sender && recipient && recipient.access >= sender) {
//      onClientDispatchOriginal.call(this, id, packet);
//  }
//}
