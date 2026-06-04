const http = require('http');

const headers = {};

if (process.env.OPS_ENDPOINT_AUTH_ENABLED === 'true' && process.env.OPS_ENDPOINT_AUTH_TOKEN) {
  headers['x-ops-auth-token'] = process.env.OPS_ENDPOINT_AUTH_TOKEN;
}

const request = http.get(
  {
    hostname: 'localhost',
    port: 3001,
    path: '/api/v1/health/ready',
    headers,
  },
  (response) => {
    response.on('end', () => {
      process.exit(response.statusCode === 200 ? 0 : 1);
    });
    response.resume();
  },
);

request.on('error', () => {
  process.exit(1);
});

request.setTimeout(4000, () => {
  request.destroy();
  process.exit(1);
});
