// The normalized shape every import becomes, whatever app or bank it came from.
// It mirrors a row of the `transactions` table, so imported history and Plaid rows
// can be read by the same code.

export type Source = "plaid" | "monarch" | "copilot" | "mint" | "ynab" | "csv" | "manual";

/** What a row means for the forecast. Transfers and hidden rows never count as spending. */
export type Kind = "income" | "spend" | "transfer" | "ignored";

export type Txn = {
  source: Source;
  /** Plaid's transaction_id, or a stable hash for imported rows so re-uploads are idempotent. */
  sourceTxnId: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Plaid's sign: positive is money out, negative is money in. */
  amount: number;
  /** Cleaned name (Monarch's merchant, Copilot's name), falling back to the bank's text. */
  name: string;
  /** The raw bank statement text when the export has it. */
  description?: string;
  category?: string;
  accountLabel?: string;
  /** Last digits of the account number, used to match imported rows to linked Plaid accounts. */
  accountMask?: string;
  /** Plaid account id, set only on Plaid rows or when an import is matched to a linked account. */
  accountId?: string;
  pending?: boolean;
  kind: Kind;
};

export type Format = Exclude<Source, "plaid" | "manual">;

export type ParseResult = {
  format: Format;
  txns: Txn[];
  /** Rows we could not read, with the reason, so the UI can say "3 rows skipped". */
  skipped: { row: number; reason: string }[];
  /** True when the export's sign convention was guessed rather than known; ask the user to confirm. */
  signGuessed: boolean;
};
