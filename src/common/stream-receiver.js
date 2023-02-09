'use strict';
const Stream = require('./stream');
const { parseStream } = require('./parse-message');

const HIGH_WATER_MARK = 1024 * 1024 * 10; // TODO: test efficiency, and make configurable
const SIGNAL_THRESHOLD = HIGH_WATER_MARK / 8;

module.exports = class StreamReceiver {
	constructor(stream, encoder, { onCancellation, onSignal }) {
		this._stream = stream;
		this._encoder = encoder;
		this._shouldDecode = !Stream.isOctetStream(stream);
		this._buffer = [];
		this._bufferSize = 0;
		this._signalledBufferSize = Infinity;
		this._receivedBytes = 0;
		this._ended = false;
		this._destroyed = false;
		this._paused = false;
		this._didSignal = false;
		this._onCancellation = onCancellation;
		this._onSignal = onSignal;

		this._writer = Stream.populate(stream, {
			onResume: () => {
				this._paused = false;
				let index = 0;
				while (index < this._buffer.length && !this._paused) {
					const data = this._buffer[index++];
					this._bufferSize -= data.byteLength;
					this._handleData(data);
				}
				if (!this._destroyed) {
					// TODO: this could be optimized by using a real Queue data structure
					this._buffer = this._buffer.slice(index);
					if (this._ended) {
						if (!this._bufferSize) {
							this._writer.end();
						}
					} else {
						this._checkSignal();
					}
				}
			},
			onDestroyed: () => {
				this._buffer = [];
				this._bufferSize = 0;
				this._destroyed = true;
				this._onCancellation();
				this._onCancellation = () => {};
				this._onSignal = () => {};
				this._writer.write = () => {};
				this._writer.end = () => {};
				this._writer.error = () => {};
			},
		});

		Promise.resolve().then(() => {
			if (!this._didSignal) {
				this._checkSignal();
			}
		});
	}

	_checkSignal() {
		if (Math.abs(this._bufferSize - this._signalledBufferSize) > SIGNAL_THRESHOLD) {
			this._onSignal(this._receivedBytes, HIGH_WATER_MARK - this._bufferSize);
			this._signalledBufferSize = this._bufferSize;
			this._didSignal = true;
		}
	}

	_handleData(data) {
		if (this._shouldDecode) {
			let value;
			try {
				value = parseStream(data, this._encoder);
			} catch (err) {
				this._onCancellation(err);
				this.error(new Error(`Scratch-RPC: ${err.message}`));
				return;
			}
			if (Stream.canWriteNull || value !== null) {
				this._paused = !this._writer.write(value);
			}
		} else {
			this._paused = !this._writer.write(data);
		}
	}

	write(data) {
		this._receivedBytes += data.byteLength;
		if (this._paused) {
			this._buffer.push(data);
			this._bufferSize += data.byteLength;
			this._checkSignal();
		} else {
			this._handleData(data);
		}
	}

	end() {
		this._ended = true;
		if (!this._bufferSize) {
			this._buffer = [];
			this._writer.end();
		}
	}

	error(err) {
		// We need to delay this by one tick, so that clients who received the
		// stream within a response are guaranteed access to the stream before
		// the "error" event is emitted.
		Promise.resolve().then(() => {
			this._buffer = [];
			this._bufferSize = 0;
			this._destroyed = true;
			this._writer.error(err);
		});
	}
};
