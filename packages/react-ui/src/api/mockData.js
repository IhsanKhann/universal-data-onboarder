export const mockModules = [
  {
    module: "hr",
    label: "HR",
    entities: [
      {
        entityKey: "employee",
        label: "Employee",
        fields: [
          { key: "employeeId", label: "Employee ID", type: "string", required: true },
          { key: "fullName", label: "Full Name", type: "string", required: true },
          { key: "email", label: "Email", type: "string", required: true },
          { key: "department", label: "Department", type: "string", required: true },
          { key: "role", label: "Role", type: "string", required: false },
          { key: "salary", label: "Salary", type: "number", required: false },
          { key: "startDate", label: "Start Date", type: "date", required: false },
          { key: "status", label: "Status", type: "enum", required: false, options: ["active", "inactive", "terminated"] },
        ],
      },
      {
        entityKey: "department",
        label: "Department",
        fields: [
          { key: "code", label: "Code", type: "string", required: true },
          { key: "name", label: "Name", type: "string", required: true },
          { key: "headId", label: "Head Employee ID", type: "string", required: false },
        ],
      },
      {
        entityKey: "branch",
        label: "Branch",
        fields: [
          { key: "code", label: "Branch Code", type: "string", required: true },
          { key: "name", label: "Branch Name", type: "string", required: true },
          { key: "address", label: "Address", type: "string", required: false },
        ],
      },
    ],
  },
  {
    module: "finance",
    label: "Finance",
    entities: [
      {
        entityKey: "invoice",
        label: "Invoice",
        fields: [
          { key: "invoiceNumber", label: "Invoice #", type: "string", required: true },
          { key: "amount", label: "Amount", type: "number", required: true },
          { key: "currency", label: "Currency", type: "string", required: true },
          { key: "dueDate", label: "Due Date", type: "date", required: true },
          { key: "status", label: "Status", type: "enum", required: false, options: ["pending", "paid", "overdue"] },
        ],
      },
      {
        entityKey: "transaction",
        label: "Transaction",
        fields: [
          { key: "transactionId", label: "Transaction ID", type: "string", required: true },
          { key: "type", label: "Type", type: "string", required: true },
          { key: "amount", label: "Amount", type: "number", required: true },
          { key: "timestamp", label: "Timestamp", type: "date", required: true },
        ],
      },
    ],
  },
  {
    module: "biz",
    label: "Business Ops",
    entities: [
      {
        entityKey: "product",
        label: "Product",
        fields: [
          { key: "sku", label: "SKU", type: "string", required: true },
          { key: "productName", label: "Product Name", type: "string", required: true },
          { key: "price", label: "Price", type: "number", required: true },
          { key: "category", label: "Category", type: "string", required: false },
        ],
      },
      {
        entityKey: "order",
        label: "Order",
        fields: [
          { key: "orderId", label: "Order ID", type: "string", required: true },
          { key: "customerId", label: "Customer ID", type: "string", required: true },
          { key: "total", label: "Total", type: "number", required: true },
          { key: "status", label: "Status", type: "enum", required: false, options: ["pending", "shipped", "delivered"] },
        ],
      },
    ],
  },
  {
    module: "communication",
    label: "Communication",
    entities: [
      {
        entityKey: "document",
        label: "Document",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
          { key: "type", label: "Type", type: "string", required: true },
          { key: "authorId", label: "Author ID", type: "string", required: true },
        ],
      },
    ],
  },
];

export const mockColumns = [
  "ID", "Full Name", "Email Address", "Dept Code", "Job Title", "Annual Salary", "Start Date", "Status"
];

export const mockFields = [
  { key: "employeeId", label: "Employee ID", type: "string", required: true },
  { key: "fullName", label: "Full Name", type: "string", required: true },
  { key: "email", label: "Email", type: "string", required: true },
  { key: "department", label: "Department", type: "string", required: true },
  { key: "role", label: "Role", type: "string", required: false },
  { key: "salary", label: "Salary", type: "number", required: false },
];

export function mockParsePreview(fileName) {
  const sampleColumns = mockColumns;
  const sampleRows = [
    { "ID": "EMP001", "Full Name": "Alice Johnson", "Email Address": "alice@acme.com", "Dept Code": "ENG", "Job Title": "Senior Engineer", "Annual Salary": "95000", "Start Date": "2024-03-15", "Status": "active" },
    { "ID": "EMP002", "Full Name": "Bob Smith", "Email Address": "bob@acme.com", "Dept Code": "MKT", "Job Title": "Marketing Lead", "Annual Salary": "82000", "Start Date": "2024-01-10", "Status": "active" },
    { "ID": "EMP003", "Full Name": "Carol Davis", "Email Address": "carol@acme.com", "Dept Code": "FIN", "Job Title": "Analyst", "Annual Salary": "72000", "Start Date": "2023-11-01", "Status": "active" },
    { "ID": "EMP004", "Full Name": "David Lee", "Email Address": "david@acme.com", "Dept Code": "ENG", "Job Title": "Engineer", "Annual Salary": "85000", "Start Date": "2024-06-01", "Status": "active" },
    { "ID": "EMP005", "Full Name": "Eva Martinez", "Email Address": "eva@acme.com", "Dept Code": "HR", "Job Title": "HR Manager", "Annual Salary": "78000", "Start Date": "2023-08-20", "Status": "inactive" },
  ];
  return {
    columns: sampleColumns,
    rows: 47,
    sampleRows,
    sourceFormat: fileName?.split(".").pop() || "csv",
  };
}

export const mockValidationResult = {
  totalCount: 47,
  validCount: 44,
  invalidCount: 3,
  sampleErrors: [
    { row: 12, message: "Missing required field: Email Address" },
    { row: 23, message: "Invalid salary format: 'N/A' is not a number" },
    { row: 31, message: "Duplicate Employee ID: EMP015 already exists" },
  ],
};

export const mockCommitResult = {
  status: "completed_with_errors",
  committed: 42,
  skipped: 2,
  failed: 3,
  message: "42 rows committed successfully. 2 rows were duplicates (skipped). 3 rows failed due to validation errors.",
  importJobId: "507f1f77bcf86cd799439011",
};
