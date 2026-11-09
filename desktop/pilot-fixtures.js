'use strict';
const config = { name: 'Synthetic River College — PILOT', currency: 'NGN', session: '2026/2027', officer: 'Demo Bursar', title: 'Bursar (synthetic)', footer: 'SYNTHETIC PILOT — not valid for payment or clearance' };
const records = [
  { reference: '00000000000000000001', student: '00001', name: 'Ada Example — synthetic student', date: '2026-11-01', currency: 'NGN', amount: '50000.00', kind: 'charge', evidence: 'Synthetic fee schedule' },
  { reference: '00000000000000000002', student: '00001', name: 'Ada Example — synthetic student', date: '2026-11-02', currency: 'NGN', amount: '25000.50', kind: 'payment', evidence: 'Synthetic bank ledger 002' },
  { reference: '00000000000000000003', student: 'SUP-0001', name: 'Example Supplies — fictional supplier', date: '2026-11-03', currency: 'NGN', amount: '10000.25', kind: 'voucher', evidence: 'Synthetic approved bill' },
  { reference: '00000000000000000004', student: '00001', name: 'Ada Example — synthetic student', date: '2026-11-04', currency: 'NGN', amount: '5000.00', kind: 'credit', evidence: 'Synthetic approved credit' }
];
const invalid = [records[0], records[0], { ...records[1], date: '2026-02-30' }, { ...records[2], amount: 'NaN' }];
const expected = { validRows: 4, grossControlTotalMinor: '9000075', statement: { opening: '0', charges: '5000000', credits: '500000', payments: '2500050', closing: '1999950' }, receiptMinor: '2500050', voucherMinor: '1000025', invalidRows: 4, invalidErrors: 3, invalidControlTotalMinor: null };
module.exports = { config, records, invalid, expected };
