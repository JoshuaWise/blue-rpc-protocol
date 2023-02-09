# scratch-rpc

Scratch-RPC is a simple but powerful RPC protocol that uses WebSockets and MessagePack to make your life easier. It is designed to be easy to use, while giving you features that solve common real-world problems.

Here are its notable features:

- First-class byte streams, useful for efficiently piping large payloads such as files.
- First-class value streams, useful for representing pub-sub subscriptions and observables.
- Universal web-compatibility, thanks to [WebSockets](https://www.rfc-editor.org/rfc/rfc6455).
- Low bandwidth usage, thanks to [MessagePack](https://msgpack.org/index.html) and [permessage-deflate](https://www.rfc-editor.org/rfc/rfc7692#section-7).
- Built-in cancellation support for RPC calls *and* streams.
- [JSON-RPC](https://www.jsonrpc.org/specification)-like notifications, useful for pushing lightweight events to the server.
- Simple RPC-style communication.
- Encodes strings, binary ([Buffer](https://nodejs.org/api/buffer.html)/[Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array)), object maps, arrays, floats, integers ([BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)), booleans, null, [Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error), and *streams* ([stream.Readable](https://nodejs.org/api/stream.html#class-streamreadable)/[ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)).

In Scratch-RPC, streams are first-class citizens. You can send streams just like another other data type, and the protocol will automatically handle things like cancellation and [backpressure](https://nodejs.org/en/docs/guides/backpressuring-in-streams/). If you cancel an RPC call, the streams you sent will automatically be destroyed. If your server method responds to an RPC call without using a stream that was sent by the client, it will automatically be cleaned up. Therefore, all the resource management is handled automatically for you.

## Installation

```
npm install scratch-rpc
```

> Requires Node.js v14.21.2 or later, or any modern browser.

## Usage

#### Server example

```js
const http = require('http');
const ScratchRPC = require('scratch-rpc');

const server = http.createServer();
const methods = {
	echo: (param) => {
		return param;
	}
};

await ScratchRPC.listen({ server, methods, logger: console.log });
```

#### Client example

```js
const ScratchRPC = require('scratch-rpc');

const client = ScratchRPC.createClient('ws://localhost');
const result = await client.invoke('echo', 'foo');

console.log('result:', result); // => "result: foo"
```

## Documentation

- [API documentation](./docs/api.md)
- [Specification](./docs/spec.md)

## License

[MIT](./LICENSE)
