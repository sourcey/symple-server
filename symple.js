var http = require('http')
  , https = require('https')
  , sio = require('socket.io')
  , fs = require('fs')


/**
 * @class
 * Symple server class.
 *
 * @param {Object} config - optional confguration object (see config.json)
 * @param {string} config.port - the port to listen on
 * @param {Object} config.redis - redis configuration
 * @param {Object} config.ssl - ssl configuration
 * @param {number} config.sessionTTL - session timeout value
 * @param {boolean} config.authentication - enable/disable authentication
 * @public
 */

function Symple(config) {
  this.config = config || {};
  this.timer = undefined;
}


/**
 * Load configuration from a file.
 *
 * @param {string} filepath - absolute path to config.json
 * @public
 */
 
Symple.prototype.loadConfig = function(filepath) {
  this.config = JSON.parse(
    fs.readFileSync(filepath).toString().replace( //
      new RegExp("\\/\\*(.|\\r|\\n)*?\\*\\/", "g"),
      "" // strip out comments
    )
  );
}


/**
 * Initialize the Symple server.
 *
 * @public
 */

Symple.prototype.init = function() {
  this.config.sessionTTL = this.config.sessionTTL || 15;
	this.initHTTP();
	this.initSocketIO();
	this.initRedis();
}


/**
 * Shutdown the Symple server.
 *
 * @public
 */

Symple.prototype.shutdown = function() {
  if (this.timer) {
    clearInterval(this.timer);
  }
  this.io.close();
  this.server.destroy();
}


/**
 * Initialize HTTP server if required.
 *
 * @private
 */
 
Symple.prototype.initHTTP = function() {
  // Create the HTTP/S server if the instance not already set
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
}


/**
 * Initialize the Socket.IO server.
 *
 * @private
 */
 
Symple.prototype.initSocketIO = function() {
  var self = this;
  
  // Bind the Socket.IO server with the HTTP server
  this.io = sio.listen(this.server);

	// Handle socket connections
	this.io.on("connection", function(socket) {
    self.onConnection(socket);
	});
}


/**
 * Initialize the Redis client connections if required.
 *
 * @private
 */
 
Symple.prototype.initRedis = function() {  
  var self = this;
  
  // https://github.com/socketio/socket.io-redis#custom-client-eg-with-authentication
  if (this.config.redis && !this.pub && !this.sub) {
    var redis = require('redis').createClient;
    var adapter = require('socket.io-redis');
    var opts = {}
    if (this.config.redis.password) {
      opts['pwd'] = this.config.redis.password;
    }
    this.pub = redis(this.config.redis.port, this.config.redis.host, opts);
    opts['return_buffers'] = true;
    this.sub = redis(this.config.redis.port, this.config.redis.host, opts);
    this.io.adapter(adapter({ pubClient: this.pub, subClient: this.sub }));
	
    // Touch sessions every 10 minutes to prevent them from expiring.
    this.timer = setInterval(function () {
      console.log('touching sessions');
      for (var i = 0; i < self.io.sockets.sockets.length; i++) {
        var socket = self.io.sockets.sockets[i];
        self.touchSession(socket.token, function(err, res) {
          //console.log(socket.id, 'touching session:', socket.token, !!res);
        });
      }
    }, (this.config.sessionTTL / 0.8) * 60000);
  }
}


/**
 * Called upon client socket connected.
 *
 * @param {Socket} socket - client socket
 * @private
 */

Symple.prototype.onConnection = function(socket) {
  console.log(socket.id, 'connection');
  var self = this,
    peer,
    timeout;

  // Give the client 2 seconds to `announce` or get booted
  timeout = setTimeout(function () {
    console.log(socket.id, 'failed to announce');
    socket.disconnect();
  }, 2000);

  // Handle the `announce` request
  socket.on('announce', function(req, ack) {

    // Authorize the connection
    self.authorize(socket, req, function(status, message) {
      console.log(socket.id, 'announce result:', status);
      clearTimeout(timeout);
      peer = socket.peer;
      
      // Authorize response
      if (status == 200) {
        self.respond(ack, status, message, peer.toPeer());
      } 
      else {
        self.respond(ack, status, message);
        socket.disconnect();
        return;
      }

      // Message
      socket.on('message', function(m, ack) {
        if (m) {
          if (m.type == 'presence')
            peer.toPresence(m);
          self.broadcast(socket, m);
          self.respond(ack, 200, 'Message received');
        }
      });

      // Peers
      // socket.on('peers', function(ack) {
      //  self.respond(ack, 200, '', self.peers(false));
      // });
    });
  });

  // Handle socket disconnection
  socket.on('disconnect', function() {
    self.onDisconnect(socket);
  });
}


/**
 * Called upon client socket disconnect.
 *
 * @param {Socket} socket - client socket
 * @private
 */

Symple.prototype.onDisconnect = function(socket) {
  console.log(socket.id, 'is disconnecting');
  
  if (socket.peer) {
  
    // Boradcast offline presence
    if (socket.peer.online) {
      socket.peer.online = false;
      var p = socket.peer.toPresence();
      this.broadcast(socket, p);
    }
    
    // Leave rooms
    socket.leave('user-' + socket.peer.user);    // leave user channel
    socket.leave('group-' + socket.peer.group);  // leave group channel
  }
}


/**
 * Called to authorize a new connection.
 *
 * @param {Socket} socket - client socket
 * @param {Object} data - arbitrary peer object
 * @param {function} fn - callback function
 * @private
 */

Symple.prototype.authorize = function(socket, req, fn) {
  var self = this;

  // Authenticated access
  if (self.config.authentication) {
    if (!req.user || !req.token)
      return fn(400, 'Bad request');

    // Retreive the session from Redis
    console.log(socket.id, 'authenticating', req);
    self.getSession(req.token, function(err, session) {
      if (err || typeof session !== 'object') {
        console.log(socket.id, 'authentication failed: no session');
        return fn(401, 'Authentication failed');
      }
      else {
        console.log(socket.id, 'authentication success');
        socket.token = req.token;
        self.authorizeValidPeer(socket, self.extend(req, session), fn);
      }
    });
  }

  // Anonymous access
  else {
    if (!req.user)
      return fn(400, 'Bad request');

    this.authorizeValidPeer(socket, this.extend(req, session), fn);
  }
}


/**
 * Create a valid peer object or return null.
 *
 * @param {Socket} socket - client socket
 * @param {Object} data - arbitrary peer object
 * @param {function} fn - callback function
 * @private
 */
 
Symple.prototype.authorizeValidPeer = function(socket, data, fn) {
  var peer = new Peer(this.extend(data, { 
    id: socket.id,
    online: true,
    name: (data.name || data.user),
    host: (socket.handshake.headers['x-real-ip']
      || socket.handshake.headers['x-forwarded-for']
      || socket.handshake.address)
  }));
  
  if (peer.valid()) {
    socket.join('user-' + peer.user);     // Join user channel
    socket.join('group-' + peer.group);   // Join group channel
    socket.peer = peer;
  
    console.log(socket.id, 'authentication success', peer);
    this.onAuthorize(socket);
    return fn(200, 'Welcome ' + peer.name);
  }
  else {
    console.log(socket.id, 'authentication failed: invalid peer object', peer);
    return fn(401, 'Invalid peer session');
  }
}


/**
 * Create a valid peer object or return null.
 *
 * @param {Socket} socket - client socket
 * @param {Peer} peer - arbitrary peer object
 * @private
 */
 
Symple.prototype.onAuthorize = function(socket, peer) {
  // nothing to do
}


/**
 * Broadcast a message over the given socket.
 *
 * @param {Socket} socket - client socket
 * @param {Object} message - message to send
 * @public
 */
 
Symple.prototype.broadcast = function(socket, message) {
  if (!message || typeof message !== 'object' || !message.from) {
    console.error(socket.id, 'dropping invalid message:', message);
    return;
  }

  // Get an destination address object for routing
  var to = this.parseToAddress(socket, message.to);

  // Make sure we have a valid destination address
  if (typeof to !== 'object' || typeof to.group === 'undefined') {
    console.error(socket.id, 'dropping invalid message without destination:', to, ':', message);
    return;
  }

  // If a session id was given then send a directed message to that session id.
  if (typeof to.id === 'string' && to.id.length) {
    this.io.to(to.id).emit('message', message); //.except(this.unauthorizedIDs())
  }

  // If a user was given (but no session id) then broadcast the message to user scope.
  // TODO: Ensure sender and receiver belong to the same group?
  else if (to.user && typeof to.user === 'string') {
    socket.broadcast.to('user-' + to.user).json.send(message); //.except(this.unauthorizedIDs())
  }

  // If a group was given (but no session id or user) then broadcast to the group scope.
  else if (to.group && typeof to.group === 'string') {
    socket.broadcast.to('group-' + to.group).json.send(message); //.except(this.unauthorizedIDs())
  }

  else {
    console.error(socket.id, 'cannot route message', message);
  }
}


Symple.prototype.respond = function(ack, status, message, data) {
  if (typeof ack !== 'function')
    return;
  var res = {}
  res.type = 'response';
  res.status = status;
  if (message)
    res.message = message;
  if (data)
    res.data = data.data || data;
  //console.log('responding', res);
  ack(res);
}


/**
 * Get a peer session by it's token.
 *
 * @param {Object} token - address string
 * @param {function} fn - callback function
 * @public
 */
 
Symple.prototype.getSession = function(token, fn) {
  this.pub.get('symple:session:' + token, function(err, reply) {
    if (reply) {
      fn(err, JSON.parse(reply));
    }
    else fn("No session", null);
  });
}


/**
 * Touch a peer session by it's token and extend 
 * it's lifetime by (config.sessionTTL) minutes.
 *
 * @param {Object} token - address string
 * @param {function} fn - callback function
 * @public
 */
 
Symple.prototype.touchSession = function(token, fn) {
  var minutes = this.config.sessionTTL || 15;
  var expiry = parseInt((+new Date)/1000) + (minutes * 60);
  this.pub.expireat("symple:session:" + token, expiry, fn);
}


/**
 * Parse a peer address with the format: user@group/id
 *
 * @param {Object} str - address string
 * @public
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


Symple.prototype.parseToAddress = function(socket, toAddress) {
  // Replace from address with server-side session data for security.
  // message.from.id = socket.session.id;
  // message.from.type = socket.session.type;
  // message.from.group = socket.session.group;
  // message.from.access = socket.session.access;
  // message.from.user = socket.session.user;
  // message.from.user_id = socket.session.user_id;
  
  switch(typeof toAddress) {
    case 'object':
      return toAddress;
    case 'string':
      return this.parseAddress(toAddress);
    case 'undefined':
      return { group: socket.peer.group };
  }
}


/**
 * Extend an object with another object.
 *
 * @param {Object} origin - target object
 * @param {Object} add - source object
 * @private
 */
 
Symple.prototype.extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || typeof add !== 'object') return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
}


/**
 * @class Peer
 * The Peer model is an abritrary data store that generally consists of:
 * - id       the peer session id
 * - online   the peer online status
 * - group    the peer group
 * - access   the peer access level [1 - 10]
 * - user     the peer user name
 * - user_id  the peer user id
 *
 * @param {Object} args - peer data object
 * @private
 */

var Peer = function(args) {
  this.read(args);
}


Peer.prototype.read = function(from) {
  for (var key in from) {
    if (from.hasOwnProperty(key))
      this[key] = from[key];
  }
}


Peer.prototype.write = function(to) {
  for (var key in this) {
    if (this.hasOwnProperty(key))
      to[key] = this[key];
  }
}


Peer.prototype.toPresence = function(p) {
  if (typeof p !== 'object')
    p = {};
  p.type = 'presence';
  p.data = this.toPeer(p.data);
  if (!p.from)
    p.from = this.address();
    
  // Allow client to change name if the input 
  // object name doesn't match the current name
  if (typeof p.name === 'string')
    this.name = p.name;
  
  return p;
}


Peer.prototype.toPeer = function(p) {
  if (typeof p !== 'object')
    p = {};
  this.write(p);
  return p;
}


Peer.prototype.address = function(peer) {
  return this.user + "@" + this.group + "/" + this.id;
}


Peer.prototype.valid = function(peer) {
  return this.id && this.user && this.group;
}


/**
 * Module exports.
 */

module.exports = Symple;
