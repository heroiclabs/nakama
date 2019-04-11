const json_to_csv = (json: any[]) =>
{
  const replacer = (key: string, value: any) => (value === null ? '' : value);
  const header = Object.keys(json[0]);
  const csv = json.map(
    row => header.map(
      field => (
        typeof row[field] === 'object' ?
        JSON.stringify(row[field], replacer).replace(
          new RegExp('\\', 'g'),
          ''
        ) :
        (`${row[field]}`.includes('"') ? `"${row[field].replace(
          new RegExp('"', 'g'),
          '""'
        )}"` : row[field])
      )
    ).join(',')
  );
  csv.unshift(header.join(','));
  return csv.join('\n');
};

export default json_to_csv;
