const http = require('http');

const port = Number.parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);

const request = http.get(
  {
    hostname: 'localhost',
    port,
    path: '/ready',
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
