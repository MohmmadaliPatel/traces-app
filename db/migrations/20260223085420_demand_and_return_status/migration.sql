-- CreateTable
CREATE TABLE "TldcData" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyId" INTEGER NOT NULL,
    "certNumber" TEXT NOT NULL,
    "din" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "pan" TEXT NOT NULL,
    "panName" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "NatureOfPayment" TEXT NOT NULL,
    "tdsAmountLimit" TEXT NOT NULL,
    "tdsAmountConsumed" TEXT NOT NULL,
    "tdsRate" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME NOT NULL,
    "cancelDate" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TldcData_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChallanData" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyId" INTEGER NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "sectionCode" TEXT NOT NULL,
    "sectionDesc" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "pymntRefNum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "filePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChallanData_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutstandingDemand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyId" INTEGER NOT NULL,
    "finYr" TEXT NOT NULL,
    "fin" TEXT NOT NULL,
    "aodmnd" TEXT NOT NULL DEFAULT '0.00',
    "cpcdmd" TEXT NOT NULL DEFAULT '0.00',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutstandingDemand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReturnStatus" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyId" INTEGER NOT NULL,
    "finyear" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "formtype" TEXT NOT NULL,
    "tokenno" TEXT NOT NULL,
    "dtoffiling" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dtofprcng" TEXT NOT NULL,
    "stmnttype" TEXT NOT NULL,
    "remarks" TEXT,
    "reason" TEXT,
    "rejectionMsg" TEXT DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReturnStatus_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TldcData_companyId_certNumber_fy_key" ON "TldcData"("companyId", "certNumber", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "ChallanData_companyId_assessmentYear_sectionCode_key" ON "ChallanData"("companyId", "assessmentYear", "sectionCode");

-- CreateIndex
CREATE UNIQUE INDEX "OutstandingDemand_companyId_finYr_key" ON "OutstandingDemand"("companyId", "finYr");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnStatus_companyId_finyear_quarter_formtype_tokenno_key" ON "ReturnStatus"("companyId", "finyear", "quarter", "formtype", "tokenno");
