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

  // Remove sensitive data
  if (typeof p.data.token === 'string')
    delete p.data.token;

  // Allow the peer to change name if the input
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


Peer.prototype.address = function() {
  return this.user + "|" + this.id; // + "@" + this.group
}


Peer.prototype.valid = function() {
  return this.id && this.user; // && this.group;
}

/**
 * Module exports.
 */

module.exports = Peer;
