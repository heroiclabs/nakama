const json_to_yaml = (obj: any, depth: number, acc: string[]) =>
{
  const type = typeof obj;
  if(obj === null || obj === undefined || obj === NaN)
  {
    acc.push(' null');
  }
  else if(obj instanceof Array)
  {
    acc.push('');
    obj.forEach(function(el)
    {
      acc.push(
        '  '.repeat(depth) + '- ' + json_to_yaml(el, depth + 1, []).trim()
      );
    });
  }
  else if(type === 'object')
  {
    let first = true;
    const prefix = '  '.repeat(depth);
    Object.keys(obj).forEach(function(key: string)
    {
      if(Object.prototype.hasOwnProperty.call(obj, key))
      {
        acc.push(
          (first ? '\n' : '') +
          prefix +
          key +
          ':' +
          json_to_yaml(obj[key] as any, depth + 1, [])
        );
        first = false;
      }
    });
  }
  else if(type === 'string')
  {
    acc.push(` "${obj}"`);
  }
  else if(type === 'boolean')
  {
    acc.push((obj ? ' true' : ' false'));
  }
  else if(type === 'number')
  {
    acc.push(' ' + obj.toString());
  }
  
  return acc.join('\n');
};

export default json_to_yaml;
