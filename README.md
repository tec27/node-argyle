#argyle
A basic SOCKS5 server library written for node.js.

##Features/Limitations
argyle supports the most basic features of SOCKS and not a whole lot more, namely:

- 'No authentication' auth mode *only*
- CONNECT commmand *only*

In the future I may add support for more auth modes and commands, but currently this implementation works well for my main use case (sitting between a local browser and server).

##Usage
###Example: "Normal" proxy server
```javascript
var argyle = require('argyle');

var server = argyle(8080, '127.0.0.1');
server.on('connected', function(req, dest) {
	req.pipe(dest);
	dest.pipe(req);
});
```

###Example: Throttled proxy server using node-throttled-stream
```javascript
var argyle = require('argyle'),
	throttle = require('./throttled-stream'),
	kbpsUp = 32,
	kbpsDown = 128;

var server = argyle(8080, '127.0.0.1');
server.on('connected', function(req, dest) {
	var tReq = throttle(req, kbpsUp * 1024),
		tDest = throttle(dest, kbpsDown * 1024);
	
	dest.once('error', function(err) { req.end(); })
		.on('close', function() { req.end(); });
	
	tReq.on('data', function(chunk) {
		dest.write(chunk);
	});
	tDest.on('data', function(chunk) {
		req.write(chunk);
	});
});
```

##Methods
###argyle([port = 8080], [host = 127.0.0.1], [debug = false])
Sets up a new SOCKS server on the specified port and host. If debug is specified, the server will output messages about the status of connections.

##Events
###'connected'
A new client connected to the server and the socket to their requested destination is now open. Handlers for this event are passed a `request` socket, corresponding to the client that made the request from the server, and a `destination` socket, corresponding to the server that they requested to connect to.

##Installation
With npm:

```
npm install argyle
```

##License
WTFPL
