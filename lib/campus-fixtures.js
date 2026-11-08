'use strict';
const { tables } = require('./campus-model');
function cleanData() {
  const data = Object.fromEntries(Object.keys(tables).map(name => [name, []]));
  data.Institutions = [{ id: 'institution-setup', institution_id: 'institution-setup', legal_name: 'Configure institution before use',
    configuration_json: JSON.stringify({ currency: 'NGN', timezone: 'Africa/Lagos', dateFormat: 'yyyy-mm-dd', rounding: 'half-up to minor unit', accountingBasis: 'unconfirmed', asOf: '2026-11-07' }) }];
  return data;
}
function demoData() {
  const data = cleanData();
  const institutionId = 'demo-campus';
  const add = (table, row) => data[table].push({ institution_id: institutionId, ...row });
  data.Institutions = [];
  add('Institutions', { id: institutionId, legal_name: 'Fictional Campus Demonstration', configuration_json: JSON.stringify({ currency: 'NGN', timezone: 'Africa/Lagos', asOf: '2026-11-07', accountingBasis: 'illustrative accrual postings only', controlAccounts: { receivable: 'ar', payable: 'ap', clearing: 'clearing' } }) });
  add('Sessions', { id: 'session-2026', name: '2026/2027', start_date: '2026-09-01', end_date: '2027-08-31' });
  add('Periods', { id: 'fy-2026', start_date: '2026-01-01', end_date: '2026-12-31', locked: false });
  add('AcademicStructures', { id: 'programme-1', parent_id: '', kind: 'programme', name: 'Synthetic accounting programme' });
  add('AcademicStructures', { id: 'level-1', parent_id: '', kind: 'level', name: '100' });
  add('Funds', { id: 'general', name: 'General operating fund', restricted: false });
  add('Funds', { id: 'restricted', name: 'Synthetic restricted grant', restricted: true });
  for (const [id, name, account_type] of [
    ['ar', 'Student receivables', 'asset'], ['clearing', 'Receipts clearing', 'asset'], ['bank', 'Bank', 'bank'],
    ['unapplied', 'Unapplied receipts', 'liability'], ['revenue', 'Fee revenue', 'income'],
    ['fees', 'Settlement fees', 'expense'], ['expense', 'Operating expenditure', 'expense'],
    ['ap', 'Supplier payables', 'liability'], ['advance', 'Staff advances', 'asset']]) add('Accounts', { id, code: id, name, account_type });
  add('Banks', { id: 'bank-1', name: 'Synthetic bank', reference: '0000000123', account_id: 'bank' });
  add('Officers', { id: 'officer-1', name: 'Demo Bursar', title: 'Bursar', approval_limit_minor: 100000000 });
  add('FeeSchedules', { id: 'fee-1', session_id: 'session-2026', programme_id: 'programme-1', level_id: 'level-1', account_id: 'revenue', amount_minor: 10000000 });
  add('Sponsors', { id: 'sponsor-1', name: 'Fictional Scholarship Fund', reference: '000-SPONSOR' });
  for (let i = 1; i <= 3; i++) {
    add('Students', { id: `s-${i}`, reference: `00000${i}`, name: `Synthetic Student ${i}`, programme_id: 'programme-1', level_id: 'level-1' });
    add('Invoices', { id: `inv-${i}`, student_id: `s-${i}`, session_id: 'session-2026', date: '2026-10-01', status: 'posted' });
    add('InvoiceLines', { id: `line-${i}`, invoice_id: `inv-${i}`, account_id: 'revenue', amount_minor: 10000000, due_date: '2026-10-15' });
  }
  add('Credits', { id: 'credit-1', invoice_id: 'inv-1', invoice_line_id: 'line-1', date: '2026-10-02', amount_minor: 1000000, reason: 'Approved illustrative waiver', status: 'posted' });
  [8000000, 12000000, 6000000].forEach((amount, i) => {
    add('Payments', { id: `p-${i + 1}`, reference: `000PAY${i + 1}`, date: '2026-10-05', amount_minor: amount,
      student_id: `s-${i + 1}`, sponsor_id: i === 2 ? 'sponsor-1' : '', cashier: 'Demo cashier', status: 'posted' });
    add('Allocations', { id: `alloc-${i + 1}`, payment_id: `p-${i + 1}`, invoice_line_id: `line-${i + 1}`, date: '2026-10-05', amount_minor: [7000000, 10000000, 5000000][i], status: 'posted' });
  });
  add('Scholarships', { id: 'award-1', sponsor_id: 'sponsor-1', student_id: 's-3', session_id: 'session-2026', awarded_minor: 6000000, applied_minor: 5000000, status: 'posted' });
  add('Refunds', { id: 'refund-1', payment_id: 'p-2', date: '2026-10-06', amount_minor: 1000000, reason: 'Unused overpayment', status: 'posted' });
  add('Settlements', { id: 'settlement-1', bank_reference: '000SETTLE1', gross_minor: 25000000, fee_minor: 200000, net_minor: 24800000, date: '2026-10-07', status: 'posted' });
  [8000000, 11000000, 6000000].forEach((amount_minor, i) => add('ReconciliationMatches', { id: `match-${i + 1}`, settlement_id: 'settlement-1', payment_id: `p-${i + 1}`, amount_minor, review_status: 'approved' }));
  add('Budgets', { id: 'budget-1', account_id: 'expense', period_id: 'fy-2026', fund_id: 'general', revision: 1, amount_minor: 10000000, status: 'posted' });
  add('Commitments', { id: 'commit-1', budget_id: 'budget-1', date: '2026-10-01', amount_minor: 4000000, status: 'posted' });
  add('Suppliers', { id: 'supplier-1', reference: '000SUP1', name: 'Fictional Lab Supplies' });
  add('Requisitions', { id: 'req-1', supplier_id: 'supplier-1', amount_minor: 4000000, status: 'approved' });
  add('PurchaseOrders', { id: 'po-1', requisition_id: 'req-1', commitment_id: 'commit-1', amount_minor: 4000000 });
  add('GoodsReceipts', { id: 'gr-1', purchase_order_id: 'po-1', date: '2026-10-08', description: 'Synthetic laboratory supplies received' });
  add('SupplierBills', { id: 'bill-1', supplier_id: 'supplier-1', purchase_order_id: 'po-1', budget_id: 'budget-1', commitment_id: 'commit-1', date: '2026-10-09', amount_minor: 3000000, status: 'posted' });
  add('SupplierPayments', { id: 'sp-1', supplier_bill_id: 'bill-1', date: '2026-10-10', amount_minor: 2000000, status: 'posted' });
  add('Advances', { id: 'advance-1', staff_reference: '000STAFF1', date: '2026-10-10', amount_minor: 500000, due_date: '2026-10-31', status: 'posted' });
  add('Retirements', { id: 'retire-1', advance_id: 'advance-1', date: '2026-10-20', amount_minor: 0, cash_return_minor: 200000, budget_id: 'budget-1', status: 'posted' });
  add('Projects', { id: 'project-1', name: 'Synthetic research grant', fund_id: 'restricted', award_minor: 5000000, start_date: '2026-01-01', end_date: '2026-12-31' });
  add('GrantEntries', { id: 'grant-1', project_id: 'project-1', date: '2026-10-01', kind: 'receipt', amount_minor: 1000000, status: 'posted' });
  add('GrantEntries', { id: 'grant-2', project_id: 'project-1', date: '2026-10-02', kind: 'expenditure', amount_minor: 200000, status: 'posted' });
  add('Assets', { id: 'asset-1', description: 'Synthetic equipment', cost_minor: 1200000, residual_minor: 0, acquisition_date: '2026-01-01', in_service_date: '2026-01-01', depreciation_start_date: '2026-01-01', life_months: 60, opening_depreciation_minor: 0 });
  add('PayrollChecks', { id: 'payroll-1', staff_reference: '000STAFF1', period_id: 'fy-2026', gross_minor: 50000000, net_minor: 45000000 });
  add('PriorPayroll', { id: 'prior-1', staff_reference: '000STAFF1', period_id: 'fy-2026', gross_minor: 48000000, net_minor: 43000000 });
  const journal = (id, source_type, source_id, date, lines) => {
    add('JournalHeaders', { id, date, period_id: 'fy-2026', source_type, source_id, reversal_of_id: '', reason: 'Synthetic illustration; institution mappings require approval', status: 'posted' });
    lines.forEach(([account_id, debit_minor, credit_minor], i) => add('JournalLines', { id: `${id}-${i + 1}`, journal_id: id, account_id, fund_id: 'general', debit_minor, credit_minor }));
  };
  for (let i = 1; i <= 3; i++) journal(`j-invoice-${i}`, 'Invoices', `inv-${i}`, '2026-10-01', [['ar', 10000000, 0], ['revenue', 0, 10000000]]);
  journal('j-credit', 'Credits', 'credit-1', '2026-10-02', [['revenue', 1000000, 0], ['ar', 0, 1000000]]);
  [8000000, 12000000, 6000000].forEach((amount, i) => journal(`j-payment-${i + 1}`, 'Payments', `p-${i + 1}`, '2026-10-05', [['clearing', amount, 0], ['unapplied', 0, amount]]));
  [7000000, 10000000, 5000000].forEach((amount, i) => journal(`j-allocation-${i + 1}`, 'Allocations', `alloc-${i + 1}`, '2026-10-05', [['unapplied', amount, 0], ['ar', 0, amount]]));
  journal('j-refund', 'Refunds', 'refund-1', '2026-10-06', [['unapplied', 1000000, 0], ['clearing', 0, 1000000]]);
  journal('j-settlement', 'Settlements', 'settlement-1', '2026-10-07', [['bank', 24800000, 0], ['fees', 200000, 0], ['clearing', 0, 25000000]]);
  journal('j-bill', 'SupplierBills', 'bill-1', '2026-10-09', [['expense', 3000000, 0], ['ap', 0, 3000000]]);
  journal('j-supplier-pay', 'SupplierPayments', 'sp-1', '2026-10-10', [['ap', 2000000, 0], ['bank', 0, 2000000]]);
  journal('j-advance', 'Advances', 'advance-1', '2026-10-10', [['advance', 500000, 0], ['bank', 0, 500000]]);
  journal('j-retire', 'Retirements', 'retire-1', '2026-10-20', [['bank', 200000, 0], ['advance', 0, 200000]]);
  return data;
}
module.exports = { cleanData, demoData };
