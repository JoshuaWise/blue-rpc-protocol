# API

- [function `listen`](#bluerpclistenoptions)
- [function `createClient`](#bluerpccreateclienturl-options)
- [class `BlueClient`][BlueClient]
	- [`client.invoke(methodName, param[, abortSignal])`](#clientinvokemethodname-param-abortsignal)
	- [`client.notify(methodName, param)`](#clientnotifymethodname-param)
	- [`client.cancel()`](#clientcancel)
- [class `MethodContext`][MethodContext]
	- [`context.signal`](#contextsignal)
	- [`context.isAborted`](#contextisaborted)
	- [`context.isNotification`](#contextisnotification)
	- [`context.connection`](#contextconnection)

## BlueRPC.listen(options)

- `options` [&lt;Object&gt;][Object]
	- `server` [&lt;http.Server&gt;][HTTPServer] an HTTP or HTTPS server instance to attach to.
	- `methods` [&lt;Object&gt;][Object] A map of RPC-style methods to serve.
	- `maxPayload` [&lt;number&gt;][number] The maximum accepted size of incoming WebSocket messages (in bytes). **Default:** `1048576` (1 MiB).
	- `perMessageDeflate` [&lt;Object&gt;][Object] | [&lt;boolean&gt;][boolean] Passed to the underlying [WebSocketServer][WebSocketServer] to configure automatic compression. **Default:** Compresses messages at least `8192` bytes (8 KiB) in size.
	- `verifyClient` [&lt;Function&gt;][Function] Passed to the underlying [WebSocketServer][WebSocketServer] to reject incoming connections. **Default**: `null`.
	- `logger` [&lt;Function&gt;][Function] If provided, auto-generated server logs will be passed to this function, for convenience. **Default**: `null`.
	- Any option allowed in [`server.listen()`](https://nodejs.org/api/net.html#serverlistenoptions-callback).
- Returns: [&lt;Promise][Promise][&lt;WebSocketServer&gt;][WebSocketServer][&gt;][Promise]

Creates and starts a [WebSocketServer](https://github.com/websockets/ws/blob/master/doc/ws.md#class-websocketserver) that uses BlueRPC to serve the given `methods`. By default, port `80` is used for [http.Servers][HTTPServer] and port `443` is used for [https.Servers][HTTPSServer], but you can pass any custom `port` you like.

All RPC methods will receive a [MethodContext][MethodContext] as their second parameter, which exposes metadata about the invocation. If an RPC method returns without using a stream that was sent by the client, such streams will automatically be cleaned up. Therefore, resource management is handled automatically for you.

The returned promise will not resolve until the server is ready to accept connections.

#### Configuring `perMessageDeflate`

Although compression can greatly reduce bandwidth usage, it also has real CPU and memory costs. Usually these costs don't become a bottleneck unless you are processing thousands of messages per second (on a typical workstation in 2023). Usually, if you are processing that many messages per second, each message is so small that bandwidth is not even an issue. This is the rationale that led to the current default setting, which only compresses messages at least 8 KiB in size. It is a compromise that tries to minimize CPU and memory costs while still using compression in cases where you are likely to benefit from it.

However, if you are sending a large number of *small* messages (below 8 KiB) and you want to hyper-optimize for low bandwidth usage (at the cost of higher CPU and memory consumpton), you can use the following `perMessageDeflate` settings:

```js
const perMessageDeflate = {
	serverNoContextTakeover: false,
	clientNoContextTakeover: false,
	concurrencyLimit: 10,
};
```

## BlueRPC.createClient(url[, options])

- `url` [&lt;string&gt;][string] The URL of the BlueRPC server to connect to.
- `options` [&lt;Object&gt;][Object]
	- `maxPayload` [&lt;number&gt;][number] The maximum accepted size of incoming WebSocket messages (in bytes). **Default:** `1048576` (1 MiB).
	- `perMessageDeflate` [&lt;Object&gt;][Object] | [&lt;boolean&gt;][boolean] Passed to the underlying [WebSocket][WebSocket] to configure automatic [message compression](https://www.rfc-editor.org/rfc/rfc7692#section-7). **Default:** Enabled for messages at least `8192` bytes (8 KiB) in size.
	- Any option allowed in [`http.request()`](https://nodejs.org/api/http.html#httprequesturl-options-callback) or [`https.request()`](https://nodejs.org/api/https.html#httpsrequesturl-options-callback).
- Returns: [&lt;BlueClient&gt;][BlueClient]

Creates a BlueRPC client and connects to the specified server. In the browser, all options are ignored.

## class *BlueClient*

This class represents a BlueRPC client. It allows you to invoke methods on a remote BlueRPC server.

### client.invoke(methodName, param[, abortSignal])

- `methodName` [&lt;string&gt;][string] The name of the remote method to invoke.
- `param` [&lt;any&gt;][any] The value to send to the remote method.
- `abortSignal` [&lt;AbortSignal&gt;][AbortSignal] A signal that the remote server will receive, if triggered. **Default:** `null`.
- Returns: [&lt;Promise][Promise][&lt;any&gt;][any][&gt;][Promise]

Invokes a method on the remote server and returns a [Promise][Promise] that will resolve with the method's result. If the method throws an exception, the promise will be rejected with the error.

If you pass an [AbortSignal][AbortSignal], you'll be able to cancel the RPC call. If you cancel an RPC call, the streams you sent will automatically be destroyed, and the promise will be rejected with an `AbortError`.

### client.notify(methodName, param)

- `methodName` [&lt;string&gt;][string] The name of the remote method to invoke.
- `param` [&lt;any&gt;][any] The value to send to the remote method.
- Returns: [&lt;Promise][Promise][&lt;undefined&gt;][undefined][&gt;][Promise]

This is the same as [client.invoke()](#clientinvokemethodname-param-abortsignal) except that it returns nothing and it cannot be aborted. In BlueRPC, notifications are a way of invoking remote methods without needing an RPC response. The returned promise resolves as soon as the notification is successfully sent.

### client.cancel()

- Returns: [&lt;undefined&gt;][undefined]

Closes all open WebSocket connections, cancelling any RPC calls or streams that were in progress. You may continue using the client normally after calling this.

## class *MethodContext*

### context.signal

- [&lt;AbortSignal&gt;][AbortSignal]

Read-only property communicating whether this RPC method was aborted by the client. Note that the client can trigger this explicitly but it will also be triggered automatically if the WebSocket connection closes.

### context.isAborted

- [&lt;boolean&gt;][boolean]

Alias for `context.signal.aborted`.

### context.isNotification

- [&lt;boolean&gt;][boolean]

Read-only property indicating whether this RPC method was invoked as a notification.

### context.connection

- [&lt;Object&gt;][Object]
	- `tls` [&lt;boolean&gt;][boolean] Whether this RPC method was invoked over a [TLS](https://nodejs.org/api/tls.html) connection.
	- `headers` [&lt;Object&gt;][Object] The headers that were sent by the client in the WebSocket opening handshake.

An object containing info about the underlying connection. This object is shared among all RPC calls on the same connection, so you can use it as a place to store your own "session data".



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
[BlueClient]: #class-blueclient
[MethodContext]: #class-methodcontext
