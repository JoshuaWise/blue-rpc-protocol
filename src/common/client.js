'use strict';
const openConnections = Symbol('openConnections');
const getConnection = Symbol('getConnection');

/*
	A BlueRPC client. It re-uses the same connection as much as possible,
	but automatically creates new connections as necessary.
 */

module.exports = class BlueClient {
	constructor(connect) {
		// Keep track of open connections, so we can close them on-demand.
		this[openConnections] = new Set();
		const registerConnection = (connection) =>{
			this[openConnections].add(connection);
			connection.onClose = () => {
				this[openConnections].delete(connection);
			};
		};

		// Re-use the same connection as long as it's open.
		// However, if the connection is old, we create a new one anyways, to
		// avoid the risk of the connection being closed due to inactivity while
		// our request is in-flight.
		let cachedConnection = null;
		this[getConnection] = async () => {
			const cached = cachedConnection; // Save variable before "await"
			if (cached) {
				const connection = await cached;
				if (connection.isOpen() && !connection.isOld()) return connection;
			}
			if (cachedConnection === cached) { // Protect from race condition
				cachedConnection = connect();
				cachedConnection.then(registerConnection);
				cachedConnection.catch(() => {}); // Suppress "Unhandled Rejections"
			}
			return cachedConnection;
		};
	}

	// Grabs an available connection and invokes a remote RPC method.
	async invoke(...args) {
		const connection = await this[getConnection]();
		return connection.invoke(...args);
	}

	// Grabs an available connection and sends an RPC notification.
	async notify(...args) {
		const connection = await this[getConnection]();
		return connection.notify(...args);
	}

	// Closes all open connections, cancelling all current operations.
	cancel() {
		for (const connection of this[openConnections]) {
			connection.close(1001, 'Cancelled by client');
		}
	}
}
