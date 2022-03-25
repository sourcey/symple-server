const http = require('http')
    , https = require('https')
    , fs = require('fs')
    , Peer = require('./peer')
    , debug = require('debug')('symple:server')
    , { Server } = require('socket.io')
    , { createAdapter } = require('@socket.io/redis-adapter')
    , { createClient } = require('redis');


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
  // this.timer = undefined;
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
  // if (this.timer) {
  //   clearInterval(this.timer);
  // }
  if (this.io)
    this.io.close();
  if (this.server)
    this.server.destroy();
  if (this.redis)
    this.redis.quit();
  if (this.pub)
    this.pub.quit();
  if (this.sub)
    this.sub.quit();
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
      http.createServer());

    this.server.listen({
      port: process.env.PORT || this.config.port,
      // backlog: 511
    });

    // // AWS ALB keepAlive is set to 60 seconds, we need to increase the default KeepAlive timeout
    // // of our node server
    // this.server.keepAliveTimeout = 65000; // Ensure all inactive connections are terminated by the ALB, by setting this a few seconds higher than the ALB idle timeout
    // this.server.headersTimeout = 66000; // Ensure the headersTimeout is set higher than the keepAliveTimeout due to this nodejs regression bug: https://github.com/nodejs/node/issues/27363
  }
}


/**
 * Initialize the Socket.IO server.
 *
 * @private
 */

Symple.prototype.initSocketIO = function() {
  const self = this;

  // Bind the Socket.IO server with the HTTP server
  const opts = {
    // allowEIO3: true
  };
  if (this.config.cors) {
    opts.cors = this.config.cors
  };

  this.io = new Server(this.server, opts);

  // Authentication middleware
  this.io.use((socket, next) => {
    self.authorize(socket, socket.handshake.auth, function(status, message) {
      if (status === 200) {
        next()
      } else {
        next(new Error(message));
      }
    })
  });

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
  const self = this;

  if (this.config.redis && !this.redis) {
    this.redis = createClient({ url: this.config.redis });
    this.redis.on('error', this.onRedisError);
    this.redis.connect();
  }

  // if (this.config.redis && !this.pub && !this.sub) {
  if (this.config.redis) {
    this.initRedisAdapter();

    // Touch sessions every `sessionTTL / 0.8` minutes to prevent them from expiring.
    // if (this.config.sessionTTL > 0) {
    //   this.timer = setInterval(function () {
    //     debug('touching sessions');
    //     for (const i = 0; i < self.io.sockets.sockets.length; i++) {
    //       const socket = self.io.sockets.sockets[i];
    //       self.touchSession(socket.token, function(err, res) {
    //         debug(socket.id, 'touching session:', socket.token, !!res);
    //       });
    //     }
    //   }, (this.config.sessionTTL / 0.8) * 60000);
    // }
  }
}

Symple.prototype.initRedisAdapter = function() {
  const self = this;

  this.pub = createClient({ url: this.config.redis });
  this.sub = this.pub.duplicate();

  this.pub.on('error', this.onRedisError);
  this.sub.on('error', this.onRedisError);

  Promise.all([this.pub.connect(), this.sub.connect()]).then(() => {
    self.io.adapter(createAdapter(self.pub, self.sub, { key: 'symple' }));
  });
}


/**
 * Called upon client socket connected.
 *
 * @param {Socket} socket - client socket
 * @private
 */

Symple.prototype.onConnection = function(socket) {
  debug(socket.id, 'connection');
  const self = this;

  // Message
  socket.on('message', function(m, ack) {
    // debug('got message', m)
    if (m) {
      // Build presence from server side session data
      // if (m.type == 'presence')
      //   socket.peer.toPresence(m);
      self.broadcast(socket, m);
      self.respond(ack, 200);
    }
  });

  // Dynmic rooms
  // TODO: Redis permission checking and Room validation
  if (self.config.dynamicRooms) {

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
      this.broadcast(socket, socket.peer.toPresence());
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

Symple.prototype.authorize = function(socket, auth, fn) {
  const self = this;

  // Authenticated access
  if (self.config.authentication) {
    if (!auth.user || !auth.token) {
      return fn(401, 'Authentication failed: Missing user or token param');
    }

    // Retreive the session from Redis
    debug(socket.id, 'authenticating', auth);
    self.getSession(auth.token, function(err, session) {
      if (err) {
        return fn(401, 'Authentication failed: ' + err);
      }
      else {
        debug(socket.id, 'authentication success');
        // socket.token = auth.token;
        self.authorizeValidPeer(socket, self.extend(auth, session), fn);
      }
    });
  }

  // Anonymous access
  else {
    if (!auth.user) {
      return fn(401, 'Authentication failed: Missing user param');
    }

    this.authorizeValidPeer(socket, auth, fn);
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
  const peer = new Peer(this.extend(data, {
    id: socket.id,
    online: true,
    name: (data.name || data.user),
    host: (socket.handshake.headers['x-real-ip']
      || socket.handshake.headers['x-forwarded-for']
      || socket.handshake.address)
  }));

  if (peer.valid()) {
    // This allows broadcasting to all connected clients at user scope
    socket.join(peer.user);
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


Symple.prototype.onRedisError = function(err) {
  console.log('Redis Client Error', err)
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
  const to = message.to;
  if (typeof to === 'undefined') {
    if (this.config.dynamicRooms) {
      // room scope
      socket.rooms.forEach(function(room) {
        if (room !== socket.id && room !== socket.peer.user) {
          socket.broadcast.to(room).emit('message', message);
        }
      });
    } else {
      // global scope
      socket.broadcast.emit('message', message);
    }
  }
  else if (typeof to === 'string') {
    const addr = this.parseAddress(to);
    socket.broadcast.to(addr.user || addr.id).emit('message', message); //.except(this.unauthorizedIDs())
  }
  else if (Array.isArray(to)) {
    // direct multi room scope
    for (let room in to) {
      socket.broadcast.to(to[room]).emit('message', message);
    };
  }
  else {
    debug(socket.id, 'cannot route message', message);
  }
}


Symple.prototype.respond = function(ack, status, message, data) {
  if (typeof ack !== 'function')
    return;
  const res = {}
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
  this.redis.get('symple:session:' + token).then((value) => {
    debug('symple session', token, value);
    if (value === null) {
      fn('No session', null);
    } else {
      const session = JSON.parse(value);
      if (typeof session !== 'object') {
        return fn('Session must be an object', null);
      } else {
        fn(null, session);
      }
    }
  }).catch((error) => {
    fn('Redis error: ' + error.message, null);
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

  const expiry = parseInt((+new Date)/1000) + (this.config.sessionTT * 60);
  this.pub.expireat('symple:session:' + token, expiry, fn);
}


/**
 * Parse a peer address with the format: user|id
 *
 * @param {Object} str - address string
 * @public
 */

Symple.prototype.parseAddress = function(str) {
  const addr = {}
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
  const users = [];
  for (let id in this.io.of(nsp).adapter.rooms[room]) {
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

  const keys = Object.keys(add);
  let i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
}


/**
 * Module exports.
 */

module.exports = Symple;
