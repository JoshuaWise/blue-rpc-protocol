'use strict';
const textEncoder = new TextEncoder();
const controllers = new WeakMap();
const onPull = Symbol('onPull'); // TODO: replace Symbol with WeakMaps
const onCancel = Symbol('onCancel'); // TODO: replace Symbol with WeakMaps

exports.Class = ReadableStream;
exports.canWriteNull = true;
exports.isLocked = (stream) => stream.locked;
exports.isOctetStream = (stream) => controllers.get(stream) instanceof ReadableByteStreamController;

// Used to create a new stream so we can receive it over Scratch-RPC.
exports.new = (isOctetStream) => {
	let controller;
	const stream = new ReadableStream({
		type: isOctetStream ? 'bytes' : undefined,
		start: (_controller) => {
			controller = _controller;
		},
		pull: () => {
			stream[onPull] && stream[onPull]();
		},
		cancel: () => {
			stream[onCancel] && stream[onCancel]();
		},
	});
	controllers.set(stream, controller);
	return stream;
};

// Used to populate a stream created by Stream.new().
exports.populate = (stream, { onResume, onDestroyed }) => {
	const controller = controllers.get(stream);
	stream[onPull] = onResume;
	stream[onCancel] = onDestroyed;
	return {
		write: (value) => {
			controller.enqueue(value);
			return controller.desiredSize > 0;
		},
		end: () => {
			controller.close();
			Promise.then().then(onDestroyed);
		},
		error: (err) => {
			controller.error(err);
			Promise.then().then(onDestroyed);
		},
	};
};

// Used to consume a stream, so we can send it over Scratch-RPC.
exports.consume = (stream, { onData, onEnd, onError, onClose }) => {
	onClose = once(onClose);

	const reader = stream.getReader();
	const noop = () => {};

	let paused = 0;
	let iteration = 1;
	const loop = ({ done, value }) => {
		if (done) return;
		iteration += 1;
		onData(value);
		paused || reader.read().then(loop, noop);
	};

	let onEndOrCancel = onEnd;
	reader.closed.then(() => onEndOrCancel(), onError).then(onClose);
	reader.read().then(loop, noop);

	return {
		pause: () => {
			if (!paused) paused = iteration;
		},
		resume: () => {
			if (paused) {
				// Re-schedule the loop only if necessary.
				if (paused !== iteration) reader.read().then(loop, noop);
				paused = 0;
			}
		},
		cancel: (...reason) => {
			onEndOrCancel = () => onClose(...reason);
			reader.cancel(...reason).catch(noop);
		},
	};
};

// This should only be used on unlocked streams.
exports.cancel = (stream) => {
	stream.getReader().cancel().catch(() => {});
};

// Utilities for processing Octet Streams.
exports.stringToOctets = (str) => textEncoder.encode(str);
exports.concatOctets = (buffers) => {
	let totalLength = 0;
	for (let i = 0; i < buffers.length; ++i) {
		totalLength += buffers[i].byteLength;
	}
	const output = new Uint8Array(totalLength);
	let offset = 0;
	for (let i = 0; i < buffers.length; ++i) {
		const buffer = buffers[i];
		output.set(buffer, offset);
		offset += buffer.byteLength;
	}
	return output;
};

function once(fn) {
	let called = false;
	return (...args) => {
		if (called) return;
		called = true;
		return fn(...args);
	};
}

Object.assign(require('../common/stream'), exports);
