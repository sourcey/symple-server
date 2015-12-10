
/**
 * Module dependencies.
 */

var http = require('http')
  , https = require('https')
  , sio = require('socket.io')
  , fs = require('fs')

/**
 * Module exports.
 */

module.exports = Symple;

/**
 * Symple server class.
 *
 * TODO: fix touch redis session
 * TODO: verify loaded session data
 *
 * @param {Object} optional, config
 * @api public
 */

function Symple(config) {
  this.config = config || {};
}

Symple.prototype.loadConfig = function(filepath) {
  this.config = JSON.parse(
    fs.readFileSync(filepath).toString().replace( //
      new RegExp("\\/\\*(.|\\r|\\n)*?\\*\\/", "g"),
      "" // strip out comments
    )
  );
}

Symple.prototype.init = function() {
  var self = this;

  // Create the HTTP server instance if not already set
  if (!this.server) {
    this.server = (this.config.ssl && this.config.ssl.enabled ?
      // HTTPS
      https.createServer({
          key: fs.readFileSync(this.config.ssl.key)
        , cert: fs.readFileSync(this.config.ssl.cert)
      }) :
      // HTTP
      http.createServer()).listen(this.config.port);
  }

  // Bind the Socket.IO server with the HTTP server
  this.io = sio.listen(this.server);

	// Fired on socket connection
	this.io.on("connection", function(socket) {
    self.onConnection(socket);
	});

  // Setup redis if required
  if (this.config.redis) {
    // var redis = require('redis').createClient;
    // var adapter = require('socket.io-redis');
    // var pub = redis(port, host, { auth_pass: "pwd" });
    // var sub = redis(port, host, { return_buffers: true, auth_pass: "pwd" });
    // io.adapter(adapter({ pubClient: pub, subClient: sub }));

    // var io = require('socket.io')(3000);
    // var redis = require('socket.io-redis');
    // this.io.adapter(redis(this.config.redis));

    var redis = require('redis').createClient;
    var adapter = require('socket.io-redis');
    this.pub = redis(this.config.redis.port, this.config.redis.host); //, { auth_pass: "pwd" }
    this.sub = redis(this.config.redis.port, this.config.redis.host, { return_buffers: true }); //, auth_pass: "pwd"
    this.io.adapter(adapter({ pubClient: this.pub, subClient: this.sub }));
  }

  console.log('Symple server listening on port ' + this.config.port);
}

/**
 * Called upon client socket connected.
 *
 * @api private
 */

Symple.prototype.onConnection = function(socket) {
  console.log(socket.id, 'connection');
  var self = this,
    session = socket.session,
    interval;

  // Give the client 2 seconds to `announce` or get booted
  interval = setInterval(function () {
      console.log(socket.id, 'failed to announce');
      socket.disconnect();
  }, 2000);

  // Handle the `announce` request
  socket.on('announce', function(req, ack) {

    // Authorize the connection
    self.authorize(socket, req, function(status, message) {
      console.log(socket.id, 'announce result:', status);
      clearInterval(interval);
      if (status == 200)
        self.respond(ack, status, message, self.toPeer(socket));
      else {
        self.respond(ack, status, message);
        socket.disconnect();
        return;
      }

      // Message
      socket.on('message', function(m, ack) {
        if (m) {
          if (m.type == 'presence')
            self.toPresence(socket, m);
          self.broadcast(socket, m);
          self.respond(ack, 200, 'Message received');
        }
      });

      // Peers
      socket.on('peers', function(ack) {
        self.respond(ack, 200, '', self.peers(false));
      });

      // Touch the session 10 minutes to prevent it from expiring.
      if (self.config.redis) {
        // TODO: use glocal timer
        interval = setInterval(function () {
          self.touchSession(session.user, session.token, function(err, res) {
            console.log(socket.id, 'touching session:', !!res);
          });
        }, 10 * 60000);
      }
    });
  });

  // Handle socket disconnection
  socket.on('disconnect', function() {
    console.log(socket.id, 'is disconnecting');
    clearInterval(interval);
    if (socket.online) {
      socket.online = false;
      var p = self.session.toPresence(socket);
      self.broadcast(p);
    }
    socket.leave('user-' + socket.session.user);    // leave user channel
    socket.leave('group-' + socket.session.group);  // leave group channel
  });
}


Symple.prototype.authorize = function(socket, req, fn) {
  var self = this;

  // Create the session
  socket.session = new Session({ token: req.token });

  // Authenticated access
  if (!self.config.anonymous) {
    if (!req.user || !req.token)
      return fn(400, 'Bad request');

    // Retreive the session from Redis
    console.log(socket.id, 'authenticating', req);
    self.getSession(req.user, req.token, function(err, data) {
      if (err) { // || typeof session.user !== 'object'
        console.log(socket.id, 'authentication failed: no session');
        return fn(401, 'Authentication failed');
      }
      else if (typeof data !== 'object' || !data.user || !data.name || !data.group) {
        console.log(socket.id, 'authentication failed: invalid session format');
        return fn(401, 'Invalid session');
      }
      else {
        console.log(socket.id, 'authentication success', data);
        // socket.session = session;             // Remote session object
        // socket.group = session.user.group;    // The client's parent group
        // socket.access = session.user.access;  // The client access level [1 - 10]
        // socket.user = session.user.user;      // The client login name
        // socket.user_id = session.user.user_id;// The client login user ID
        socket.session.write(data);
        self.onAuthorize(socket, req);
        return fn(200, 'Welcome ' + socket.session.name);
      }
    });
  }

  // Anonymous access
  else {
    if (!req.user)
      return fn(400, 'Bad request');

    socket.session.write({
      access: -1,
      name: req.name,
      group: req.group,
      user: req.user,
      user_id: req.user_id
    });
    self.onAuthorize(socket, req);
    return fn(200, 'Welcome ' + socket.session.name);
  }
}

Symple.prototype.onAuthorize = function(socket, req) {
  socket.session.online = true;
  socket.session.name = req.name ?                // The client display name
      req.name : socket.user;
  socket.session.type = req.type;                 // The client type
  socket.join('user-' + socket.session.user);     // Join user channel
  socket.join('group-' + socket.session.group);   // Join group channel
}

Symple.prototype.toPresence = function(socket, p) {
  if (!p || typeof p !== 'object')
    p = {};
  p.type = 'presence';
  p.data = this.toPeer(socket, p.data);
  if (!p.from)
    p.from = this.toAddress(socket);
  //if (!p.from || typeof p.from !== 'object') {
  //  p.from = {};
  //  p.from.name = this.name;
  //}
  return p;
}

Symple.prototype.toPeer = function(socket, p) {
  if (!p || typeof p !== 'object')
    p = {};
  p.id = socket.id; //sympleID;
  p.type = socket.session.type;
  p.node = socket.session.node;
  p.user = socket.session.user;
  p.user_id = socket.session.user_id;
  p.group = socket.session.group;
  p.access = socket.session.access;
  p.online = socket.session.online;
  p.host = socket.handshake.headers['x-real-ip']
    || socket.handshake.headers['x-forwarded-for']
    || socket.handshake.address; //this.handshake ?  : '';

  // allow client to change name
  if (typeof p.name === 'string')
    socket.session.name = p.name;
  else
    p.name = socket.session.name;

  return p;
}


Symple.prototype.toAddress = function(socket) {
  return socket.session.user + "@" + socket.session.group + "/" + socket.id;
}

Symple.prototype.getSession = function(user, token, fn) {
  this.pub.get('symple:' + user + ':' + token, function(err, reply) {
    console.log("reply", reply)
    if (reply) {
      fn(err, JSON.parse(reply));
    }
    else fn("No session", null);
  });
}

Symple.prototype.touchSession = function(user, token, fn) {
  this.pub.expireat("symple:*:" + token, 15 * 60, fn);
}

Symple.prototype.getDestinationAddress = function(socket, message) {
  switch(typeof message.to) {
    case 'object':
      return message.to;
    case 'string':
      return this.parseAddress(socket, message.to);
    case 'undefined':
      return { group: socket.session.group };
  }
}

Symple.prototype.broadcast = function(socket, message) {
  if (!message || typeof message !== 'object' || !message.from) {
    console.error(socket.id, 'dropping invalid message:', message);
    return;
  }

  // Replace from address with server-side peer data for security.
  // message.from.id = socket.session.id;
  // message.from.type = socket.session.type;
  // message.from.group = socket.session.group;
  // message.from.access = socket.session.access;
  // message.from.user = socket.session.user;
  // message.from.user_id = socket.session.user_id;

  // Get an destination address object for routing
  var to = this.getDestinationAddress(socket, message);

  // Make sure we have a valid destination address
  if (typeof to !== 'object' || typeof to.group === 'undefined') {
    console.error(socket.id, 'dropping invalid message without destination:', to, ':', message);
    return;
  }

  // If a session id was given we send a directed message to that session id.
  if (typeof to.id === 'string' && to.id.length) {
    socket.namespace/*.except(this.unauthorizedIDs())*/.socket(to.id).json.send(message);
  }

  // If a user was given (but no session id) we broadcast a message to user scope.
  // TODO: Ensure group membership
  else if (to.user && typeof to.user === 'string') {
    socket.broadcast.to('user-' + to.user/*, this.unauthorizedIDs()*/).json.send(message);
  }

  // If a group was given (but no session id or user) we broadcast to group scope.
  else if (to.group && typeof to.group === 'string') {
    socket.broadcast.to('group-' + to.group/*, this.unauthorizedIDs()*/).json.send(message);
  }

  else {
    console.error(socket.id, 'cannot route invalid message:', message);
  }
}

Symple.prototype.respond = function(ack, status, message, data) {
  if (typeof ack !== 'function')
    return;
  var res = {}
  res.type = 'response';
  res.status = status;
  res.message = message;
  if (data)
    res.data = data.data ? data.data : data;
  console.log('responding: ', res);
  ack(res);
}

/**
 * Parses a Symple endpoint address with the format: user@group/id
 *
 * @param {Object} address string
 * @api private
 */

Symple.prototype.parseAddress = function(str) {
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


Symple.prototype.buildAddress = function(peer) {
  return peer.user + "@" + peer.group + "/" + peer.id;
}

/**
 * Session model.
 *
 * @param {Object} args
 * @api public
 */

var Session = function(args) {
  this.write(args);
}

Session.prototype.write = function(args) {
  for (var key in args) {
    this[key] = args[key];
  }
}

//
// Socket.IO Manager extensions
//

//Symple.prototype.authorizedClients = function() {
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
//Symple.prototype.peers = function(includeSelf) {
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
//Symple.prototype.unauthorizedIDs = function() {
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
