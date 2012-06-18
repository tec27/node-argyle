/*jshint laxcomma:true asi:true */
var net = require('net')
  , util = require('util')
  , EventEmitter = require('events').EventEmitter

var debugOut = console.log.bind(console)

module.exports = function(port, host, debug) {
  if(!port) port = 8080
  if(!host) host = '127.0.0.1'

  return new Argyle(port, host, debug)
}

function Argyle(port, host, debug) {
  Argyle.super_.call(this)
  var self = this

  if(!!debug) this._debug = debugOut
  else this._debug = function() {}

  this.serverSock = net.createServer()
  this.serverSock.on('listening', function() {
    var addr = self.serverSock.address()
    self._debug('socks server listening on %s:%s', addr.address, addr.port)
  }).on('connection', function(client) {
    self.handleConnection(client)
  })

  this.serverSock.listen(port, host)
}
util.inherits(Argyle, EventEmitter);

Argyle.socksVersion = 5

var STATES =  { handshake: 0
              , request: 1
              , forwarding: 2
              }
Argyle.prototype.handleConnection = function(client) {
  var curState = STATES.handshake
    , handlers = {}
    , self = this

  function onClientData(chunk) {
    handlers[curState](chunk)
  }

  client.on('end', function() {
  }).on('error', function(err) {
  }).on('data', onClientData)

  var buffer = null
  handlers[STATES.handshake] = function(chunk) {
    buffer = expandAndCopy(buffer, chunk)
    if(buffer.length < 2) return

    var socksVersion = buffer[0]
    if(socksVersion != Argyle.socksVersion) {
      self._debug('unsupported client version: %d', socksVersion)
      return client.end()
    }

    var nMethods = buffer[1];
    if(buffer.length < nMethods + 2) return;
    for(var i = 0; i < nMethods; i++) {
      // try to find the no-auth method type, and if found, choose it
      if(buffer[i+2] === 0) {
        client.write(new Buffer([0x05, 0x00]))
        curState++
        if(buffer.length > nMethods + 2) {
          var newChunk = buffer.slice(nMethods + 2)
          buffer = null
          handlers[STATES.request](newChunk)
        }
        buffer = null
        return
      }
    }

    self._debug('No supported auth methods found, disconnecting.')
    client.end(new Buffer([0x05, 0xff]))
  }

  var proxyBuffers = []
  handlers[STATES.request] = function(chunk) {
    buffer = expandAndCopy(buffer, chunk)
    if(buffer.length < 4) return

    var socksVersion = buffer[0];
    if(socksVersion != Argyle.socksVersion) {
      self._debug('unsupported client version: %d', socksVersion)
      return client.end()
    }

    var cmd = buffer[1];
    if(cmd != 0x01) {
      self._debug('unsupported command: %d', cmd)
      return client.end(new Buffer([0x05, 0x01]))
    }

    var addressType = buffer[3]
      , host
      , port
      , responseBuf
    if(addressType == 0x01) { // ipv4
      if(buffer.length < 10) return // 4 for host + 2 for port
      host = util.format('%d.%d.%d.%d', buffer[4], buffer[5], buffer[6], buffer[7])
      port = buffer.readUInt16BE(8)
      responseBuf = new Buffer(10)
      buffer.copy(responseBuf, 0, 0, 10)
      buffer = buffer.slice(10)
    }
    else if(addressType == 0x03) { // dns
      if(buffer.length < 5) return // if no length present yet
      var addrLength = buffer[4]
      if(buffer.length < 5 + addrLength + 2) return // host + port
      host = buffer.toString('utf8', 5, 5+addrLength)
      port = buffer.readUInt16BE(5+addrLength)
      responseBuf = new Buffer(5 + addrLength + 2)
      buffer.copy(responseBuf, 0, 0, 5 + addrLength + 2)
      buffer = buffer.slice(5 + addrLength + 2)
    }
    else if(addressType == 0x04) { // ipv6
      if(buffer.length < 22) return // 16 for host + 2 for port
      host = buffer.slice(4, 20)
      port = buffer.readUInt16BE(20)
      responseBuf = new Buffer(22)
      buffer.copy(responseBuf, 0, 0, 22)
      buffer = buffer.slice(22);
    }
    else {
      self._debug('unsupported address type: %d', addressType)
      return client.end(new Buffer([0x05, 0x01]))
    }

    self._debug('Request to %s:%s', host, port)
    curState++

    var connected = false
    var dest = net.createConnection(port, host, function() {
      responseBuf[1] = 0
      responseBuf[2] = 0
      client.write(responseBuf) // emit success to client
      client.removeListener('data', onClientData)

      client.resume()
      self.emit('connected', client, dest)
      connected = true
      if(buffer && buffer.length) {
        client.emit(buffer)
        buffer = null
      }
      for(var j = 0; j < proxyBuffers.length; j++) { // re-emit any leftover data for proxy to handle
        client.emit('data', proxyBuffers[i])
      }
      proxyBuffers = []
    }).once('error', function(err) {
      if(!connected) {
        client.end(new Buffer([0x05, 0x01]))
      }
    }).once('close', function() {
      if(!connected) {
        client.end()
      }
    })
    client.pause()
  }

  handlers[STATES.forwarding] = function (chunk) {
    proxyBuffers.push(chunk);
  }
}

function expandAndCopy(old, newer) {
  if(!old) return newer;
  var newBuf = new Buffer(old.length + newer.length);
  old.copy(newBuf);
  newer.copy(newBuf, old.length);

  return newBuf;
}

// vim: tabstop=2:shiftwidth=2:softtabstop=2:expandtab

