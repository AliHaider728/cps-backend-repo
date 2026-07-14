import dotenv from "dotenv";
dotenv.config();

const testId = process.env.XERO_CLIENT_ID_TEST;
const prodId = process.env.XERO_CLIENT_ID_PROD;
const testSecret = process.env.XERO_CLIENT_SECRET_TEST;
const prodSecret = process.env.XERO_CLIENT_SECRET_PROD;
const redirectUri = process.env.XERO_REDIRECT_URI;

console.log("XERO_CLIENT_ID_TEST:", testId ? `'${testId}' (${testId.length} chars)` : "EMPTY");
console.log("XERO_CLIENT_ID_PROD:", prodId ? `'${prodId}' (${prodId.length} chars)` : "EMPTY");
console.log("XERO_CLIENT_SECRET_TEST:", testSecret ? `'${testSecret}' (${testSecret.length} chars)` : "EMPTY");
console.log("XERO_CLIENT_SECRET_PROD:", prodSecret ? `'${prodSecret}' (${prodSecret.length} chars)` : "EMPTY");
console.log("XERO_REDIRECT_URI:", redirectUri ? `'${redirectUri}' (${redirectUri.length} chars)` : "EMPTY");
