export type Field = { key: string; label: string; type?: 'text' | 'long' | 'number' | 'money' | 'date' | 'datetime' | 'choice' | 'reference' | 'boolean' | 'color' | 'checklist' | 'reminder'; choices?: string[]; ref?: string; required?: boolean; default?: any; hint?: string };
export const sections: { key: string; title: string; icon: string; group?: string }[] = [
  { key: '', title: 'Home', icon: 'grid-outline' }, { key: 'calendar', title: 'Calendar', icon: 'calendar-outline' },
  { key: 'notes', title: 'Notes', icon: 'document-text-outline' }, { key: 'reminders', title: 'Reminders', icon: 'notifications-outline' }, { key: 'folders', title: 'Folders', icon: 'folder-outline' },
  { key: 'trades', title: 'Trades', icon: 'swap-horizontal-outline', group: 'trading' }, { key: 'pnl', title: 'P&L', icon: 'stats-chart-outline', group: 'trading' }, { key: 'screenshots', title: 'Screenshots', icon: 'images-outline', group: 'trading' }, { key: 'strategies', title: 'Strategies', icon: 'git-branch-outline', group: 'trading' }, { key: 'accounts', title: 'Accounts', icon: 'wallet-outline', group: 'trading' },
  { key: 'grades', title: 'School Grades', icon: 'school-outline' }, { key: 'homework', title: 'Homework', icon: 'checkbox-outline' }, { key: 'tests', title: 'Tests', icon: 'reader-outline' }, { key: 'subscriptions', title: 'Subscriptions', icon: 'repeat-outline' }, { key: 'finance', title: 'Finance', icon: 'card-outline' }, { key: 'timetable', title: 'Weekly Subjects', icon: 'time-outline' },
];
const title: Field = { key: 'title', label: 'Title', required: true };
const name: Field = { key: 'name', label: 'Name', required: true };
const date: Field = { key: 'date', label: 'Date', type: 'date', required: true };
const subject: Field = { key: 'subject_id', label: 'Subject', type: 'reference', ref: 'subjects', required: true };
const notes: Field = { key: 'notes', label: 'Notes', type: 'long' };
const description: Field = { key: 'description', label: 'Description', type: 'long' };
const color: Field = { key: 'color', label: 'Colour', type: 'color', default: '#596D5B' };
const type: Field = { key: 'type', label: 'Type', type: 'choice', choices: ['Written', 'Oral'], default: 'Written' };
const reminder: Field[] = [{ key: 'reminder_minutes', label: 'Reminder', type: 'reminder' }, { key: 'alert_time', label: 'Alert time for date-only deadlines', default: '08:00', hint: 'Local time · HH:mm. Used when no time is set.' }];
const time: Field = { key: 'time', label: 'Time · HH:mm', hint: 'Optional · 24-hour format' };
const amount: Field = { key: 'amount', label: 'Amount', type: 'money', required: true };
const category: Field = { key: 'category', label: 'Category' };
const archived: Field = { key: 'archived', label: 'Archived', type: 'boolean', default: false };
const account: Field = { key: 'account_id', label: 'Trading account', type: 'reference', ref: 'accounts', required: true };
export const schemas: Record<string, Field[]> = {
  subjects: [name, color, archived], folders: [name, color],
  events: [title, date, { key: 'all_day', label: 'All day', type: 'boolean', default: false }, time, { key: 'end_time', label: 'End time · HH:mm' }, description, { key: 'location', label: 'Location' }, color, ...reminder],
  reminders: [title, description, date, { ...time, required: true }, { key: 'status', label: 'Status', type: 'choice', choices: ['Pending', 'Completed'], default: 'Pending' }, { key: 'reminder_minutes', label: 'Minutes before', type: 'number', default: 0 }],
  homework: [title, subject, description, date, time, ...reminder, { key: 'status', label: 'Status', type: 'choice', choices: ['To do', 'Done'], default: 'To do' }],
  tests: [title, subject, type, date, time, notes, ...reminder, { key: 'status', label: 'Status', type: 'choice', choices: ['Scheduled', 'Completed'], default: 'Scheduled' }],
  grades: [subject, { key: 'value', label: 'Grade · 0–10', type: 'number', required: true }, type, date, notes],
  subscriptions: [name, { ...amount, label: 'Amount · EUR' }, { key: 'frequency', label: 'Frequency', type: 'choice', choices: ['Weekly', 'Monthly', 'Quarterly', 'Yearly'], default: 'Monthly' }, { key: 'next_date', label: 'First renewal / recurrence anchor', type: 'date', required: true, hint: 'The original day is preserved in shorter months.' }, category, notes, ...reminder, { key: 'status', label: 'Status', type: 'choice', choices: ['Active', 'Paused', 'Cancelled', 'Archived'], default: 'Active' }],
  finance: [{ key: 'type', label: 'Type', type: 'choice', choices: ['Income', 'Expense'], default: 'Expense' }, { ...amount, label: 'Amount · EUR' }, date, category, description, { key: 'status', label: 'Status', type: 'choice', choices: ['Planned', 'Recorded', 'Cancelled'], default: 'Planned' }],
  accounts: [name, { key: 'type', label: 'Account type', type: 'choice', choices: ['Personal', 'Evaluation', 'Funded'], default: 'Personal' }, { key: 'provider', label: 'Provider' }, { key: 'currency', label: 'Currency · ISO code', default: 'USD' }, { key: 'opening_balance', label: 'Opening balance', type: 'money', default: 0 }, { key: 'opening_date', label: 'Opening date', type: 'date', required: true }, archived],
  cashflows: [account, { key: 'type', label: 'Type', type: 'choice', choices: ['Deposit', 'Withdrawal'], default: 'Deposit' }, amount, date, notes],
  strategies: [name, description, { key: 'entry_rules', label: 'Entry rules', type: 'long' }, { key: 'exit_rules', label: 'Exit rules', type: 'long' }, { key: 'risk_management', label: 'Risk management', type: 'long' }, { key: 'checklist', label: 'Checklist · one item per line', type: 'checklist' }, notes, archived],
  trades: [account, { key: 'instrument', label: 'Instrument', required: true, default: 'XAUUSD' }, { key: 'direction', label: 'Direction', type: 'choice', choices: ['Long', 'Short'], default: 'Long' }, { key: 'status', label: 'Status', type: 'choice', choices: ['Open', 'Closed'], default: 'Open' },
    { key: 'opened_at', label: 'Opened at', type: 'datetime', required: true }, { key: 'closed_at', label: 'Closed at', type: 'datetime' },
    { key: 'entry_price', label: 'Entry price', type: 'number' }, { key: 'exit_price', label: 'Exit price', type: 'number' }, { key: 'stop_loss', label: 'Stop loss', type: 'number' }, { key: 'take_profit', label: 'Take profit', type: 'number' }, { key: 'quantity', label: 'Quantity', type: 'number' },
    { key: 'gross_pnl', label: 'Manual gross P&L', type: 'money', hint: 'Before commission and swap. Never enter net P&L here.' }, { key: 'commission', label: 'Commission · positive cost', type: 'money', default: 0 }, { key: 'swap', label: 'Swap · signed amount', type: 'money', default: 0 }, { key: 'initial_risk', label: 'Initial risk · money', type: 'money' }, { key: 'strategy_id', label: 'Strategy', type: 'reference', ref: 'strategies' }, notes],
  notes: [title, { ...subject, required: false }, { key: 'folder_id', label: 'Folder', type: 'reference', ref: 'folders' }],
  screenshots: [title, date, notes, { key: 'trade_id', label: 'Linked trade', type: 'reference', ref: 'trades' }],
};
export const singular: Record<string, string> = { subjects: 'subject', folders: 'folder', events: 'event', reminders: 'reminder', homework: 'homework', tests: 'test', grades: 'grade', subscriptions: 'subscription', finance: 'transaction', accounts: 'account', cashflows: 'cashflow', strategies: 'strategy', trades: 'trade', notes: 'note', screenshots: 'screenshot' };