
import crypto from 'crypto';

export function generatePayloadHash(entityId: string, entity: any, entityType: string): string {
  const companyProps = mapClientToCompany(entityId, entity, entityType).properties;
  
  const contacts = [];
  const parentKey = `${entityType}:${entityId}`;
  for (const bucket of ['decisionMakers', 'financeContacts', 'contacts']) {
    for (const c of entity[bucket] || []) {
      if (!c._id) continue;
      const contactProps = mapContactToHubSpotContact(c._id.toString(), c, parentKey, bucket).properties;
      contacts.push(contactProps);
    }
  }

  const normalizedPayload = { company: companyProps, contacts };
  return crypto.createHash('sha256').update(JSON.stringify(normalizedPayload)).digest('hex');
}
export function mapClientToCompany(clientId: string, clientData: any, entityType: string) {
  const externalKey = `${entityType}:${clientId}`;
  
  const properties: Record<string, string> = {
    name: clientData.name || clientData.federationName || 'Unknown Company',
    cps_external_key: externalKey,
    cps_entity_type: entityType,
    cps_record_id: clientId.toString()
  };

  if (clientData.domain) properties.domain = clientData.domain;
  if (clientData.phone) properties.phone = clientData.phone;
  if (clientData.address) properties.address = clientData.address;
  if (clientData.city) properties.city = clientData.city;
  if (clientData.postcode) properties.zip = clientData.postcode;
  if (clientData.country) properties.country = clientData.country;

  // New fields requested for PCN/Practice
  if (clientData.contractType) properties.cps_contract_type = clientData.contractType;
  if (clientData.hourlyRate != null) properties.cps_hourly_rate = clientData.hourlyRate.toString();
  
  if (clientData.contractStartDate) {
    const d = new Date(clientData.contractStartDate);
    if (!isNaN(d.getTime())) {
      // HubSpot expects midnight UTC for date properties
      d.setUTCHours(0,0,0,0);
      properties.cps_contract_start_date = d.getTime().toString();
    }
  }
  
  if (clientData.contractRenewalDate) {
    const d = new Date(clientData.contractRenewalDate);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(0,0,0,0);
      properties.cps_contract_renewal_date = d.getTime().toString();
    }
  }
  
  if (clientData.contractExpiryDate) {
    const d = new Date(clientData.contractExpiryDate);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(0,0,0,0);
      properties.cps_contract_expiry_date = d.getTime().toString();
    }
  }
  
  if (clientData.xeroCode) {
    properties.cps_xero_code = clientData.xeroCode;
    if (clientData.xeroCategory) {
      properties.cps_xero_reference = `${clientData.xeroCode} (${clientData.xeroCategory})`;
    } else {
      properties.cps_xero_reference = clientData.xeroCode;
    }
  }

  return { properties };
}

export function mapContactToHubSpotContact(contactId: string, contactData: any, parentKey: string, bucket: string) {
  const properties: Record<string, string> = {
    cps_contact_external_key: `${parentKey}:${bucket}:${contactId}`,
    cps_contact_type: bucket,
    cps_parent_external_key: parentKey
  };

  const nameParts = (contactData.name || contactData.fullName || '').trim().split(' ');
  if (nameParts.length > 0 && nameParts[0]) {
    properties.firstname = nameParts[0];
  }
  if (nameParts.length > 1) {
    properties.lastname = nameParts.slice(1).join(' ');
  }

  if (contactData.email) properties.email = contactData.email;
  
  const phone = contactData.phone || contactData.mobile;
  if (phone) properties.phone = phone;

  const jobTitle = contactData.role || contactData.jobTitle;
  if (jobTitle) properties.jobtitle = jobTitle;

  return { properties };
}
