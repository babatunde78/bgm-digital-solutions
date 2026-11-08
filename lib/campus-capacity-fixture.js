'use strict';
const { createHash } = require('node:crypto');
const { demoData } = require('./campus-fixtures');
const { tables } = require('./campus-model');
function capacityData(count = 100) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Use 1 to 100 prepared rows');
  const data = demoData();
  for (const [name, definition] of Object.entries(tables)) if (definition.module !== 'shared') data[name] = [];
  const institutionId = data.Institutions[0].id;
  data.Institutions[0].legal_name = 'Synthetic Capacity Campus';
  const add = (table, record) => data[table].push({ institution_id: institutionId, ...record });
  add('FeeSchedules', { id: 'capacity-fee', session_id: 'session-2026', programme_id: 'programme-1', level_id: 'level-1', account_id: 'revenue', amount_minor: 1000000 });
  add('Budgets', { id: 'capacity-budget', account_id: 'expense', period_id: 'fy-2026', fund_id: 'general', revision: 1, amount_minor: count * 1000000, status: 'posted' });
  for (let index = 1; index <= count; index++) {
    const key = String(index).padStart(3, '0');
    add('Students', { id: `cap-student-${key}`, reference: String(index).padStart(10, '0'), name: `Synthetic Capacity Student ${key}`, programme_id: 'programme-1', level_id: 'level-1' });
    add('Invoices', { id: `cap-invoice-${key}`, student_id: `cap-student-${key}`, session_id: 'session-2026', date: '2026-10-01', status: 'posted' });
    add('InvoiceLines', { id: `cap-line-${key}`, invoice_id: `cap-invoice-${key}`, account_id: 'revenue', amount_minor: 1000000, due_date: '2026-10-15' });
    add('Payments', { id: `cap-payment-${key}`, reference: `000CAP${key}`, date: '2026-10-05', amount_minor: 750000, student_id: `cap-student-${key}`, sponsor_id: '', cashier: 'Synthetic cashier', status: 'posted' });
    add('Allocations', { id: `cap-allocation-${key}`, payment_id: `cap-payment-${key}`, invoice_line_id: `cap-line-${key}`, date: '2026-10-05', amount_minor: 750000, status: 'posted' });
    add('Settlements', { id: `cap-settlement-${key}`, bank_reference: `000SET${key}`, gross_minor: 750000, fee_minor: 10000, net_minor: 740000, date: '2026-10-07', status: 'posted' });
    add('ReconciliationMatches', { id: `cap-match-${key}`, settlement_id: `cap-settlement-${key}`, payment_id: `cap-payment-${key}`, amount_minor: 750000, review_status: 'approved' });
    add('Suppliers', { id: `cap-supplier-${key}`, reference: `000SUP${key}`, name: `Synthetic Supplier ${key}` });
    add('Commitments', { id: `cap-commitment-${key}`, budget_id: 'capacity-budget', date: '2026-10-01', amount_minor: 150000, status: 'posted' });
    add('Requisitions', { id: `cap-requisition-${key}`, supplier_id: `cap-supplier-${key}`, amount_minor: 150000, status: 'approved' });
    add('PurchaseOrders', { id: `cap-po-${key}`, requisition_id: `cap-requisition-${key}`, commitment_id: `cap-commitment-${key}`, amount_minor: 150000 });
    add('GoodsReceipts', { id: `cap-goods-${key}`, purchase_order_id: `cap-po-${key}`, date: '2026-10-08', description: 'Synthetic capacity goods receipt' });
    add('SupplierBills', { id: `cap-bill-${key}`, supplier_id: `cap-supplier-${key}`, purchase_order_id: `cap-po-${key}`, budget_id: 'capacity-budget', commitment_id: `cap-commitment-${key}`, date: '2026-10-09', amount_minor: 100000, status: 'posted' });
    add('SupplierPayments', { id: `cap-supplier-payment-${key}`, supplier_bill_id: `cap-bill-${key}`, date: '2026-10-10', amount_minor: 80000, status: 'posted' });
    add('Advances', { id: `cap-advance-${key}`, staff_reference: `000STAFF${key}`, date: '2026-10-10', amount_minor: 100000, due_date: '2026-10-31', status: 'posted' });
    add('Retirements', { id: `cap-retirement-${key}`, advance_id: `cap-advance-${key}`, date: '2026-10-20', amount_minor: 40000, cash_return_minor: 10000, budget_id: 'capacity-budget', status: 'posted' });
  }
  const journal = (source, date, lines) => {
    const id = `capacity-${source}`;
    const records = data[source];
    const total = source === 'Invoices' ? data.InvoiceLines.reduce((value, row) => value + row.amount_minor, 0) : records.reduce((value, row) => value + (row.amount_minor || row.gross_minor || 0) + (row.cash_return_minor || 0), 0);
    add('ImportBatches', { id, content_hash: createHash('sha256').update(JSON.stringify(records)).digest('hex'), source, status: 'validated', row_count: count, total_minor: total });
    add('JournalHeaders', { id, date, period_id: 'fy-2026', source_type: 'ImportBatches', source_id: id, reversal_of_id: '', reason: 'Synthetic manually specified batch posting for capacity acceptance', status: 'posted' });
    lines.forEach(([account_id, debit, credit], index) => add('JournalLines', { id: `${id}-${index + 1}`, journal_id: id, account_id, fund_id: 'general', debit_minor: debit * count, credit_minor: credit * count }));
  };
  journal('Invoices', '2026-10-01', [['ar', 1000000, 0], ['revenue', 0, 1000000]]);
  journal('Payments', '2026-10-05', [['clearing', 750000, 0], ['unapplied', 0, 750000]]);
  journal('Allocations', '2026-10-05', [['unapplied', 750000, 0], ['ar', 0, 750000]]);
  journal('Settlements', '2026-10-07', [['bank', 740000, 0], ['fees', 10000, 0], ['clearing', 0, 750000]]);
  journal('SupplierBills', '2026-10-09', [['expense', 100000, 0], ['ap', 0, 100000]]);
  journal('SupplierPayments', '2026-10-10', [['ap', 80000, 0], ['bank', 0, 80000]]);
  journal('Advances', '2026-10-10', [['advance', 100000, 0], ['bank', 0, 100000]]);
  journal('Retirements', '2026-10-20', [['expense', 40000, 0], ['bank', 10000, 0], ['advance', 0, 50000]]);
  return data;
}
module.exports = { capacityData };
