var http = require('http')
  , https = require('https')
  , sio = require('socket.io')
  , fs = require('fs')
  , Peer = require('./peer')
  , adapter = require('./adapter')
  , debug = require('debug')('symple:server');


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
      http.createServer()).listen(process.env.PORT || this.config.port);
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
	this.io.on('connection', function(socket) {
    self.onConnection(socket);
	});
}


/**
 * Initialize the Redis adapter if required.
 *
 * @private
 */

Symple.prototype.initRedis = function() {
  var self = this;

  if (this.config.redis && !this.pub && !this.sub) {
    var redis = require('redis').createClient;
    var opts = {}
    if (this.config.redis.password) {
      opts['pwd'] = this.config.redis.password;
    }
    this.pub = redis(this.config.redis.port, this.config.redis.host, opts);
    opts['return_buffers'] = true;
    this.sub = redis(this.config.redis.port, this.config.redis.host, opts);
    this.io.adapter(adapter({ key: 'symple', pubClient: this.pub, subClient: this.sub }));

    // Touch sessions every `sessionTTL / 0.8` minutes to prevent them from expiring.
    if (this.config.sessionTTL > 0) {
      this.timer = setInterval(function () {
        debug('touching sessions');
        for (var i = 0; i < self.io.sockets.sockets.length; i++) {
          var socket = self.io.sockets.sockets[i];
          self.touchSession(socket.token, function(err, res) {
            debug(socket.id, 'touching session:', socket.token, !!res);
          });
        }
      }, (this.config.sessionTTL / 0.8) * 60000);
    }
  }
}


/**
 * Called upon client socket connected.
 *
 * @param {Socket} socket - client socket
 * @private
 */

Symple.prototype.onConnection = function(socket) {
  debug(socket.id, 'connection');
  var self = this,
    peer,
    timeout;

  // Give the client 4 seconds to `announce` or get booted
  timeout = setTimeout(function () {
    debug(socket.id, 'failed to announce');
    socket.disconnect();
  }, 4000);

  // Handle the `announce` request
  socket.on('announce', function(req, ack) {

    // Authorize the connection
    self.authorize(socket, req, function(status, message) {
      debug(socket.id, 'announce result:', status);
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
        // debug('got message', m)
        if (m) {
          if (m.type == 'presence')
            peer.toPresence(m);
          self.broadcast(socket, m);
          self.respond(ack, 200);
        }
      });

      // Dynmic rooms
      // TODO: Redis permission checking and Room validation
      if (self.config.dynamicRooms) {
        debug(socket.id, 'enabling dynamic rooms');

        // Join Room
        socket.on('join', function(room, ack) {
          debug(socket.id, 'joining room', room);
          socket.join(room, function(err) {
            if (err) {
              debug(socket.id, 'cannot join room', err);
              self.respond(ack, 404, 'Cannot join room: ' + err);
            }
            else {
              self.respond(ack, 200, 'Joined room: ' + room);
            }
          });
        });

        // Leave Room
        socket.on('leave', function(room, ack) {
          debug(socket.id, 'leaving room', room);
          socket.leave(room, function(err) {
            if (err) {
              debug(socket.id, 'cannot leave room', err);
              self.respond(ack, 404, 'Cannot leave room: ' + err);
            }
            else {
              self.respond(ack, 200, 'Left room: ' + room);
            }
          });
        });
      }

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
  debug(socket.id, 'is disconnecting');

  if (socket.peer) {

    // Broadcast offline presence
    if (socket.peer.online) {
      socket.peer.online = false;
      var p = socket.peer.toPresence();
      this.broadcast(socket, p);
    }

    // Leave rooms
    socket.leave(socket.peer.user);    // leave user channel
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
    if (!req.user || !req.token) {
      return fn(401, 'Authentication failed: Missing user or token param');
    }

    // Retreive the session from Redis
    debug(socket.id, 'authenticating', req);
    self.getSession(req.token, function(err, session) {
      if (err) {
        return fn(401, 'Authentication failed: Invalid session');
      }
      if (typeof session !== 'object') {
        return fn(401, 'Authentication failed: Session must be an object');
      }
      else {
        debug(socket.id, 'authentication success');
        socket.token = req.token;
        self.authorizeValidPeer(socket, self.extend(req, session), fn);
      }
    });
  }

  // Anonymous access
  else {
    if (!req.user) {
      return fn(401, 'Authentication failed: Missing user param');
    }

    this.authorizeValidPeer(socket, req, fn);
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
    socket.join(peer.user);     // Join user channel
    // socket.join('group-' + peer.group);   // Join group channel
    socket.peer = peer;

    debug(socket.id, 'authentication success', peer);
    this.onAuthorize(socket);
    return fn(200, 'Welcome ' + peer.name);
  }
  else {
    debug(socket.id, 'authentication failed: invalid peer object', peer);
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
    debug(socket.id, 'dropping invalid message:', message);
    return;
  }

  debug(socket.id, 'broadcasting message:', message);

  // Get an destination address object for routing
  var to = message.to;
  if (to === undefined) {
    socket.broadcast.json.send(message);
  }
  else if (typeof to === 'string') {
    var addr = this.parseAddress(to);
    socket.broadcast.json.to(addr.user || addr.id).send(message); //.except(this.unauthorizedIDs())
  }
  else if (Array.isArray(to)) {
    // send to an multiple rooms
    for (var room in to) {
      socket.broadcast.json.to(to[room]).send(message);
    };
  }
  else {
    debug(socket.id, 'cannot route message', message);
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
  debug('responding', res);
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
    else fn('No session', null);
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
  if (this.config.sessionTTL == -1)
    return;

  var expiry = parseInt((+new Date)/1000) + (this.config.sessionTT * 60);
  this.pub.expireat('symple:session:' + token, expiry, fn);
}


/**
 * Parse a peer address with the format: user|id
 *
 * @param {Object} str - address string
 * @public
 */

Symple.prototype.parseAddress = function(str) {
  var addr = {}
    arr = str.split('|')

  if (arr.length < 2) // no id
    addr.user = arr[0];
  else { // has id
    addr.user = arr[0];
    addr.id = arr[1];
  }

  return addr;
}


Symple.prototype.getSocketsByRoom = function(nsp, room) {
  var users = [];
  for (var id in this.io.of(nsp).adapter.rooms[room]) {
    users.push(this.io.of(nsp).adapter.nsp.connected[id]);
  };
  return users;
};


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
 * Module exports.
 */

module.exports = Symple;
