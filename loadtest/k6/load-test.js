import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const ttJobDone = new Trend('tt_job_done_ms', true);
const serverHits = new Counter('server_hits');

const SERVER_URL = __ENV.ENIGMA_SERVER_URL || 'http://40.113.111.66:8080';
const MODEL = __ENV.MODEL || 'qwen2.5:0.5b';

export const options = {
  stages: [
    { duration: '5m',  target: 13027 },  // Ramp-up
    { duration: '10m', target: 13027 },  // Sustained load
    { duration: '2m',  target: 0     },  // Ramp-down
  ],
  thresholds: {
    'http_req_failed':  ['rate<0.01'],   // <1% HTTP errors
    'errors':           ['rate<0.01'],   // <1% job failures
    'tt_job_done_ms':   ['p(99)<30000'], // p99 < 30s
  },
};

const PROMPTS = [
  'Was ist 2+2?',
  'Name three colors.',
  'What is the capital of France?',
  'Say hello in German.',
  'Count to five.',
  'What color is the sky?',
  'Name a mammal.',
];

export default function () {
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const start = Date.now();

  // 1. Submit job
  const submitRes = http.post(
    `${SERVER_URL}/api/v1/jobs`,
    JSON.stringify({ prompt, model: MODEL }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'submit' },
    }
  );

  const submitOk = check(submitRes, {
    'job submitted (201)': (r) => r.status === 201,
  });
  errorRate.add(!submitOk);
  if (!submitOk) return;

  const jobID = submitRes.json('job_id');
  if (!jobID) {
    errorRate.add(1);
    return;
  }

  // Track which enigma server instance handled the submit
  const serverInst = submitRes.headers['X-Enigma-Server'] || 'unknown';
  serverHits.add(1, { server: serverInst });

  // 2. Poll for completion (max 60 attempts x 1s = 60s timeout)
  let done = false;
  for (let i = 0; i < 60 && !done; i++) {
    sleep(1);

    const statusRes = http.get(
      `${SERVER_URL}/api/v1/jobs/${jobID}`,
      { tags: { endpoint: 'poll' } }
    );

    if (statusRes.status !== 200) continue;

    const jobStatus = statusRes.json('status');
    if (jobStatus === 'done') {
      done = true;
      ttJobDone.add(Date.now() - start);
    } else if (jobStatus === 'failed') {
      done = true;
      errorRate.add(1);
    }
  }

  if (!done) {
    errorRate.add(1);
  }
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    'loadtest/k6/results.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const lines = [
    '\n=== Enigma Load Test Summary ===',
    `Errors:          ${((m.errors?.values?.rate || 0) * 100).toFixed(2)}%`,
    `p50 job done:    ${m.tt_job_done_ms?.values?.['p(50)'] || 'n/a'}ms`,
    `p95 job done:    ${m.tt_job_done_ms?.values?.['p(95)'] || 'n/a'}ms`,
    `p99 job done:    ${m.tt_job_done_ms?.values?.['p(99)'] || 'n/a'}ms`,
    `HTTP req failed: ${((m.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%`,
    `Total requests:  ${m.http_reqs?.values?.count || 0}`,
    '',
  ];
  return lines.join('\n');
}
