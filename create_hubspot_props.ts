import { hubspotClient } from './integrations/hubspot/hubspot.client.js';

const propertiesToCreate = [
  { name: "cps_contract_type", label: "CPS Contract Type", type: "string", fieldType: "text", groupName: "companyinformation" },
  { name: "cps_hourly_rate", label: "CPS Hourly Rate", type: "number", fieldType: "number", groupName: "companyinformation" },
  { name: "cps_contract_start_date", label: "CPS Contract Start Date", type: "date", fieldType: "date", groupName: "companyinformation" },
  { name: "cps_contract_renewal_date", label: "CPS Contract Renewal Date", type: "date", fieldType: "date", groupName: "companyinformation" },
  { name: "cps_contract_expiry_date", label: "CPS Contract Expiry Date", type: "date", fieldType: "date", groupName: "companyinformation" },
  { name: "cps_xero_code", label: "CPS Xero Code", type: "string", fieldType: "text", groupName: "companyinformation" },
  { name: "cps_xero_reference", label: "CPS Xero Reference", type: "string", fieldType: "text", groupName: "companyinformation" }
];

async function createProperties() {
  for (const prop of propertiesToCreate) {
    try {
      await hubspotClient.post('/crm/v3/properties/companies', prop);
      console.log(`Created property: ${prop.name}`);
    } catch (e: any) {
      if (e.response?.status === 409) {
        console.log(`Property already exists: ${prop.name}`);
      } else {
        console.error(`Failed to create property ${prop.name}:`, e.response?.data || e.message);
      }
    }
  }
}

createProperties().then(() => process.exit(0));
