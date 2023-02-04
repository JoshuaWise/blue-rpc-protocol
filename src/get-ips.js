'use strict';
const os = require('os');

// Returns an array of this host's IPv4 addresses.
module.exports = () => {
	return Object.values(os.networkInterfaces())
		.flat()
		.filter(x => x.family === 'IPv4')
		.sort((a, b) => a.internal - b.internal)
		.map(x => x.address);
};
