// Include Symple
var Symple = require('./symple');

// Create Symple server instance
var sy = new Symple();
sy.loadConfig(__dirname + "/config.json");
sy.init();

// Access Socket.IO functions if required
sy.io.use(function(socket, next) {
  var handshakeData = socket.request;
  // make sure the handshake data looks good as before
  // if error do this:
    // next(new Error('not authorized');
  // else just call next
  next();
});
