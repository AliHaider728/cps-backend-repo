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
