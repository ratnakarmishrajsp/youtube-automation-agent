const test = require('node:test');
const assert = require('node:assert');
const { validateGuideNumbersAndBrands, extractNumbers } = require('../scripts/pdf/make-guide');

test('extractNumbers parses digits, currencies, and percentages', () => {
  const text = 'Anthropic ne 21X surge dekha. Pehle 3 days the, ab 7-day manual audit hai. RTO 75% se 15% ho gaya. Price ₹1499 or $1000.';
  const numbers = extractNumbers(text);
  assert.ok(numbers.includes('21X'));
  assert.ok(numbers.includes('3'));
  assert.ok(numbers.includes('7'));
  assert.ok(numbers.includes('75%'));
  assert.ok(numbers.includes('15%'));
  assert.ok(numbers.includes('₹1499'));
  assert.ok(numbers.includes('$1000'));
});

test('validateGuideNumbersAndBrands passes when all numbers exist in transcript', () => {
  const transcript = 'Claude startup application 21X surge ki wajah se ruk gaya. Ab 7 din lagenge verify hone mein.';
  const guideData = {
    title: 'Claude Startup Rejection',
    sections: [
      {
        heading: 'Surge Metrics',
        bullets: ['Application surge 21X badh gaya hai.', 'Audit period ab 7 din ka hai.']
      }
    ],
    checklist: ['Wait 7 days for verification'],
    keyTakeaway: '21X surge handled with manual audits.'
  };

  const result = validateGuideNumbersAndBrands(guideData, transcript);
  assert.strictEqual(result, true);
});

test('validateGuideNumbersAndBrands throws error when fake/hallucinated number is inserted', () => {
  const transcript = 'Claude startup application 21X surge ki wajah se ruk gaya. Ab 7 din lagenge.';
  const fakeGuideData = {
    title: 'Claude Fake Guide',
    sections: [
      {
        heading: 'Fake Metrics',
        bullets: [
          'Application surge 21X ho gaya.',
          'Funding $50,000 mil rahi hai.', // Fake number not in transcript
          'Rejected within 99 days.'       // Another fake number
        ]
      }
    ]
  };

  assert.throws(
    () => {
      validateGuideNumbersAndBrands(fakeGuideData, transcript);
    },
    (err) => {
      assert.ok(err.message.includes('[HARD GUARD FAILED]'));
      assert.ok(err.message.includes('$50,000') || err.message.includes('50,000'));
      assert.ok(err.message.includes('99'));
      return true;
    }
  );
});
