import http from 'axios';
import { toLower, assign } from 'lodash';
import { getSavedSources, getCommonMeta } from '../common';
import { logger, uriParser } from '../../../utility';

const getIdentifier = (source, options) => {
  const identifierName = source.schema.identifier;
  const identifier = options.params[identifierName];

  if (!identifier) {
    logger.error('Identifier field not found in params');
    throw new Error('Identifier field not found in params');
  }

  return identifier;
};

const getSortPrefix = (sortOrder) => {
  const sortOrderParam = toLower(sortOrder);
  let sortPrefix = '';

  if (sortOrderParam === 'desc') sortPrefix = '-';
  else if (sortOrderParam === 'asc') sortPrefix = '+';

  return sortPrefix;
};

const getApiParams = (clientParams) => {
  const apiParams = {};

  // TODO: Add field filter handling
  apiParams.sort = `${getSortPrefix(clientParams.sort)}${clientParams.sortBy}`;
  apiParams.limit = clientParams.limit || clientParams.pageSize;
  apiParams.page = clientParams.page || clientParams.currentPage;
  apiParams.search = clientParams.search;
};

const getCommonParams = (connector) => {
  const authConfig = connector.options.auth;
  const basicAuthParams = authConfig.username && authConfig.password ? {
    headers: {
      authorization: `Basic ${btoa(`${authConfig.username}:${authConfig.password}`)}`,
    },
  } : {};

  return assign(getCommonMeta(connector), basicAuthParams);
};

// API Methods

const createSourceData = (connector, source, options) => {
  const { endpoint } = connector.options;
  const { payload } = options;

  const url = uriParser.joinUrl(endpoint, `/sources/${source.name}`);

  return http.post(url, payload, getCommonParams(connector)).then(response => response.data);
};

const updateSourceData = (connector, source, options) => {
  const identifier = getIdentifier(source, options);
  const { endpoint } = connector.options;
  const { payload } = options;

  const url = uriParser.joinUrl(endpoint, `${endpoint}/sources/${source.name}/${identifier}`);

  return http.put(url, payload, getCommonParams(connector)).then(response => response.data);
};

const deleteSourceData = (connector, source, options) => {
  const identifier = getIdentifier(source, options);
  const { endpoint } = connector.options;

  const url = `${endpoint}/sources/${source.name}/${identifier}`;

  return http.delete(url, getCommonParams(connector)).then(response => response.data);
};

export default {
  getSources(connector, { savedOnly }) {
    if (savedOnly) return getSavedSources(connector);

    const { endpoint } = connector.options;
    const url = uriParser.joinUrl(endpoint, '/sources');

    return http.get(url, getCommonParams(connector)).then(response => response.data.sources);
  },
  getSourceSchema(connector, source) {
    const { endpoint } = connector.options;
    const url = uriParser.joinUrl(endpoint, `/sources/${source.name}/schema`);

    return http.get(url, getCommonParams(connector)).then(response => response.data);
  },
  getSourceData(connector, source, options) {
    const { endpoint } = connector.options;
    const url = uriParser.joinUrl(endpoint, `/sources/${source.name}`);
    const params = options && options.params ? getApiParams(options.params) : null;

    return http.get(url, assign(getCommonParams(connector), params))
      .then(response => response.data);
  },
  changeSourceData(connector, source, options) {
    const actionName = toLower(options.action);

    const actionMap = {
      delete: deleteSourceData,
      update: updateSourceData,
      create: createSourceData,
    };

    if (!actionMap[actionName]) {
      logger.error('Undefined Generic HTTP changeSource action');
      throw new Error('Undefined Generic HTTP changeSource action');
    }

    return actionMap[actionName](connector, source, options);
  },
};
