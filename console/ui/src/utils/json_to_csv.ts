const json_to_csv = (json: any[]) =>
{
  const replacer = (key: string, value: any) => (value === null ? '' : value);
  const header = Object.keys(json[0]);
  const csv = json.map(
    row => header.map(
      field => JSON.stringify(row[field], replacer)
    ).join(',')
  );
  csv.unshift(header.join(','));
  return csv.join('\n');
};

export default json_to_csv;
