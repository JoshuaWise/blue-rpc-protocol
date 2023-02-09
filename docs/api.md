# API

- [function `listen`](#scratchrpclistenoptions)
- [function `createClient`](#scratchrpccreateclienturl-options)
- [class `ScratchClient`][ScratchClient]
	- [`client.invoke(methodName, param)`](#clientinvokemethodname-param-abortsignal)
	- [`client.notify(methodName, param)`](#clientnotifymethodname-param)
	- [`client.listen(methods)`](#clientlisten-methods)
	- [`client.close([error])`](#clientcloseerror)
	- [`client.terminate([error])`](#clientterminateerror)
	- [`client.closed`](#clientclosed)
- [class `MethodContext`][MethodContext]
	- [`context.notify(methodName, param)`](#contextnotifymethodname-param)
	- [`context.broadcast(methodName, param)`](#contextbroadcastmethodname-param)
	- [`context.isNotification`](#contextisnotification)

### ScratchRPC.listen(options)

- `options` [<Object>][Object]
	- `server` [<http.Server>][HTTPServer] an HTTP or HTTPS server instance to attach to.
	- `methods` [<Object>][Object] A map of RPC-style methods to serve.
	- `maxPayload` [<number>][number] The maximum accepted size of incoming WebSocket messages (in bytes). **Default:** `1048576` (1 MiB).
	- `perMessageDeflate` [<Object>][Object] | [<boolean>][boolean] Passed to the underling [WebSocketServer][WebSocketServer] to configure automatic [message compression](https://www.rfc-editor.org/rfc/rfc7692#section-7). **Default:** Enabled for messages at least `8192` bytes (8 KiB) in size.
	- `verifyClient` [<Function>][Function] Passed to the underling [WebSocketServer][WebSocketServer] to conditionally accept or reject incoming connections. **Default**: `null`.
	- `logger` [<Function>][Function] If provided, auto-generated server logs will be passed to this function, for convenience. **Default**: `null`.
	- Any option allowed in [`server.listen()`](https://nodejs.org/api/net.html#serverlistenoptions-callback).
- Returns: [<Promise][Promise][<WebSocketServer>][WebSocketServer][>][Promise]

Creates and starts a [WebSocketServer](https://github.com/websockets/ws/blob/master/doc/ws.md#class-websocketserver) that uses Scratch-RPC to serve the given `methods`. By default, port `80` is used for [http.Servers][HTTPServer] and port `443` is used for [https.Servers][HTTPSServer], but you can pass any custom `port` you like.

All RPC methods will receive a [MethodContext][MethodContext] as their second parameter, which exposes metadata about the invocation.

The returned promise will not resolve until the server is ready to accept connections.

##### Configuring `perMessageDeflate`

Although compression can greatly reduce bandwidth usage, it also has significant CPU and memory costs. Usually these costs don't become a bottleneck unless you are processing thousands of messages per second (on a typical workstation in 2023). Usually, if you are processing that many messages per second, each message is so small that bandwidth is not even an issue. This is the rationale that led to the current default setting, which only compresses messages at least 8 KiB in size. It is a compromise that tries to minimize CPU and memory costs while still using compression in cases where you are likely to benefit from it.

However, if you are sending a large number of *small* messages (below 8 KiB) and you want to hyper-optimize for low bandwidth usage (at the cost of higher CPU and memory consumpton), you can use the following `perMessageDeflate` settings:

```js
const perMessageDeflate = {
	serverNoContextTakeover: false,
	clientNoContextTakeover: false,
	concurrencyLimit: 10,
};
```

### ScratchRPC.createClient(url[, options])

- `url` [<string>][string] The URL of the Scratch-RPC server to connect to.
- `options` [<Object>][Object]
	- `maxPayload` [<number>][number] The maximum accepted size of incoming WebSocket messages (in bytes). **Default:** `1048576` (1 MiB).
	- `perMessageDeflate` [<Object>][Object] | [<boolean>][boolean] Passed to the underling [WebSocket][WebSocket] to configure automatic [message compression](https://www.rfc-editor.org/rfc/rfc7692#section-7). **Default:** Enabled for messages at least `8192` bytes (8 KiB) in size.
	- Any option allowed in [`http.request()`](https://nodejs.org/api/http.html#httprequesturl-options-callback) or [`https.request()`](https://nodejs.org/api/https.html#httpsrequesturl-options-callback).
- Returns: [<ScratchClient>][ScratchClient]

Creates a Scratch-RPC client and connects to the specified server. In the browser, all options are ignored.

# class *ScratchClient*

This class represents a Scratch-RPC client. It allows you to invoke methods on a remote Scratch-RPC server.

### client.invoke(methodName, param[, abortSignal])

- `methodName` [<string>][string] The name of the remote method to invoke.
- `param` [<any>][any] The value to send to the remote method.
- `abortSignal` [<AbortSignal>][AbortSignal] A signal that the remote server will receive, if triggered. **Default:** `null`.
- Returns: [<Promise][Promise][<any>][any][>][Promise]

Invokes a method on the remote server and returns a [Promise][Promise] that will resolve with the method's result. If the method throws an exception, the promise will be rejected with the error.

### client.notify(methodName, param)

- `methodName` [<string>][string] The name of the remote method to invoke.
- `param` [<any>][any] The value to send to the remote method.
- Returns: [<Promise][Promise][<undefined>][undefined][>][Promise]

This is the same as [client.invoke()](#clientinvokemethodname-param-abortsignal) except that it returns nothing and it cannot be aborted. In Scratch-RPC, notifications are a way of invoking remote methods without needing an RPC response. The returned promise resolves as soon as the notification is successfully sent.

### client.cancel()

- Returns: [<undefined>][undefined]

Closes all open WebSocket connections, cancelling any RPC calls or streams that were in progress. You may continue using the client normally after calling this.

# class *MethodContext*

### context.signal

- [<AbortSignal>][AbortSignal]

Read-only property communicating whether this RPC method was aborted by the client. Note that the client can trigger this explicitly but it will also be triggered automatically if the WebSocket connection closes.

### context.isAborted

- [<boolean>][boolean]

Alias for `context.signal.aborted`.

### context.isNotification

- [<boolean>][boolean]

Read-only property indicating whether this RPC method was invoked as a notification.

### context.connection

- [<Object>][Object]
	- `tls` [<boolean>][boolean] Whether this RPC method was invoked over a [TLS](https://nodejs.org/api/tls.html) connection.
	- `headers` [<Object>][Object] The headers that were sent by the client in the WebSocket opening handshake.

An object containing info about the underling connection. This object is shared among all RPC calls on the same connection, so you can use it as a place to store your own "session data".



[any]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types
[undefined]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type
[null]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#null_type
[boolean]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type
[number]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type
[string]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type
[Array]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array
[Object]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
[Function]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function
[Error]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
[Promise]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise
[AbortSignal]: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
[Buffer]: https://nodejs.org/api/buffer.html#class-buffer
[ReadableStream]: https://nodejs.org/api/stream.html#class-streamreadable
[WritableStream]: https://nodejs.org/api/stream.html#class-streamwritable
[HTTPServer]: https://nodejs.org/api/http.html#class-httpserver
[HTTPSServer]: https://nodejs.org/api/https.html#class-httpsserver
[WebSocketServer]: https://github.com/websockets/ws/blob/master/doc/ws.md#class-websocketserver
[WebSocket]: https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketaddress-protocols-options
[ScratchClient]: #class-scratchclient
[MethodContext]: #class-methodcontext
