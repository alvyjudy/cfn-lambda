
module.exports = options => (...args) => {
  console.log('Using cfn-lambda SDKAlias to define an operation')
  switch (args.length) {
    // Create
    case 2:
      console.log('Aliasing method %s as CREATE operation.', options.method)
      SimpleAlias(options, null, args[0], args[1])
      break
    // Delete
    case 3:
      console.log('Aliasing method %s as DELETE or NOOPUPDATE operation.', options.method)
      SimpleAlias(options, args[0], args[1], args[2])
      break
    // Update
    case 4:
      console.log('Aliasing method %s as UPDATE operation.', options.method)
      SimpleAlias(options, args[0], args[1], args[3])
      break
    default:
      throw new Error('Could not determine cfn-lambda SDKAlias method signature at runtime.')
  }
}

function SimpleAlias(options, physicalId, params, reply) {
  if (params) {
    delete params.ServiceToken;
  }
  var usedParams = usableParams({ params, options, physicalId })
  var physicalIdFunction = 'function' === typeof options.returnPhysicalId
    ? options.returnPhysicalId
    : 'string' === typeof options.returnPhysicalId
      ? accessFunction(options.returnPhysicalId)
      : noop;
  options.api[options.method](usedParams, function(err, data) {
    if (!err || isIgnorable(options.ignoreErrorCodes, err)) {
      console.log('Aliased method succeeded: %j', data);
      return reply(null, physicalIdFunction(data, params),
        attrsFrom(options, data));
    }
    console.log('Aliased method had error: %j', err);
    reply(err.message);
  });
}

function attrsFrom(options, data) {
  var attrFunction = Array.isArray(options.returnAttrs) && options.returnAttrs.every(isString)
    ? keyFilter.bind(null, options.returnAttrs)
    : (
        'function' === typeof options.returnAttrs
          ? options.returnAttrs
          : noop
      );
  return attrFunction(data);
}


const forcePaths = (params, pathSet, translator) => {
  pathSet.forEach(path => {
    const pathTokens = path.split('.')
    const lastToken = pathTokens.pop()
    const intermediate = pathTokens.reduce((obj, key, index) => {
      if ('*' === key) {
        return forcePaths(obj, Object.keys(obj).map(indexOrElement => [indexOrElement].concat(pathTokens.slice(index + 1)).concat(lastToken).join('.')), translator)
      }
      return obj == null
        ? undefined
        : obj[key]
    }, params)
    if (intermediate) {
      if (lastToken === '*') {
        if (Array.isArray(intermediate)) {
          intermediate.forEach((value, index) => intermediate[index] = translator(value))
        } else {
          Object.keys(intermediate).forEach(key => intermediate[key] = translator(intermediate[key]))
        }
      } else if (intermediate[lastToken] !== undefined) {
        intermediate[lastToken] = translator(intermediate[lastToken])
      }
    }
  })
  return params
}

const forceNum = (params, pathSet) => forcePaths(params, pathSet, value => +value)

const forceBoolean = (params, pathSet) => forcePaths(params, pathSet, value => ({
  '0': false,
  'false': false,
  '': false,
  'null': false,
  'undefined': false,
  '1': true,
  'true': true
})[value])


const chain = functors => starting => functors.reduce((current, functor) => functor(current), starting)
const defaultToObject = params => params || {}
const forceBoolsWithin = ({ forceBools }) => params => Array.isArray(forceBools) && forceBools.every(isString) ? forceBoolean(params, forceBools) : params
const forceNumsWithin = ({ forceNums }) => params => Array.isArray(forceNums) && forceNums.every(isString) ? forceNum(params, forceNums) : params
const maybeAliasPhysicalId = ({ physicalId, physicalIdAs }) => params => isString(physicalIdAs) ? addAliasedPhysicalId(params, physicalIdAs, physicalId) : params
const filterToKeys = ({ keys }) => params => Array.isArray(keys) && keys.every(isString) ? keyFilter(keys, params) : params
const mapWithKeys = ({ mapKeys }) => params => Object(mapKeys) === mapKeys ? useKeyMap(params, mapKeys) : params
const maybeDowncase = ({ downcase }) => params => downcase ? downcaseKeys(params) : params


const usableParams = ({
  params,
  options: { forceBools, forceNums, physicalIdAs, keys, mapKeys, downcase, method },
  physicalId
}) => {
  console.log(params)
  const paramProcessor = chain([
    defaultToObject,
    forceBoolsWithin({ forceBools }),
    forceNumsWithin({ forceNums }),
    maybeAliasPhysicalId({ physicalId, physicalIdAs }),
    filterToKeys({ keys }),
    mapWithKeys({ mapKeys }),
    maybeDowncase({ downcase })
  ])

  const usedParams = paramProcessor(params)
  console.log('Calling aliased method %s with params: %j',
    method, usedParams);
  return usedParams;
}

const addAliasedPhysicalId = (params, physcialIdAlias, physicalId) => ({ ...params, [physcialIdAlias]: physicalId })

const downcaseKeys = hash => Object.keys(hash).reduce((dced, key) => ({ ...dced, [key[0].toLowerCase() + key.slice(1, key.length)]: hash[key] }), {})

const isString = obj => 'string' === typeof obj

const isIgnorable = (ignorableErrorCodes, errObject) => Array.isArray(ignorableErrorCodes) && !!~ignorableErrorCodes.indexOf(errObject.statusCode)


const accessFunction = key => {
  var actualKey = key
  const getDataSimple = data => data == null ? undefined : data[actualKey]

  const getDataRecursive = data => {
    if (actualKey.includes('.')) {
      const pathTokens = actualKey.split('.')
      const firstElem = pathTokens[0]
      const childData = data[firstElem]
      const childPath = pathTokens.slice(1).join('.')
      actualKey = childPath
      return getDataRecursive(childData)
    }
    return getDataSimple(data)
  }

  return getDataRecursive
}

function useKeyMap(params, keyMap) {
  return Object.keys(params).reduce(function(mapped, key) {
    mapped[keyMap[key] ? keyMap[key] : key] = params[key];
    return mapped;
  }, {});
}

function noop() {

}

function keyFilter(includedKeySet, hash) {
  return includedKeySet.reduce(function(fHash, key) {
    fHash[key] = accessFunction(key)(hash);
    return fHash;
  }, {});
}
