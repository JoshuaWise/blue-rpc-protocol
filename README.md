# scratch-rpc

Scratch-RPC is a simple RPC protocol that uses WebSockets and MessagePack to make your life easier. It is designed to be simple to use, while giving you features that solve common real-world problems.

Here are its notable features:
- First-class byte streams, useful for efficiently piping large payloads such as files.
- First-class value streams, useful for representing pub-sub subscriptions and observables.
- Built-in cancellation support for RPC calls *and* streams.
- [JSON-RPC](https://www.jsonrpc.org/specification)-like notifications, useful for pushing lightweight events to the server.
- Universal web-compatibility, thanks to [WebSockets](https://www.rfc-editor.org/rfc/rfc6455).
- Low bandwidth usage, thanks to [MessagePack](https://msgpack.org/index.html) and [permessage-deflate](https://www.rfc-editor.org/rfc/rfc7692#section-7).
- Simple RPC-style communication.

## Installation

```
npm install scratch-rpc
```

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

const client = await ScratchRPC.connect('ws://localhost');
const result = await client.invoke('echo', 'foo');
await client.close();

console.log('result:', result); // => "result: foo"
```

## Documentation

- [API documentation](./docs/api.md)
- [Specification](./docs/spec.md)

## License

[MIT](./LICENSE)
