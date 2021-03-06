/*
Reserved for Ride Core connector.
*/
import http from 'axios';
import {
  assign,
  each,
  filter,
  find,
  isArray,
  isNil,
  keyBy,
  keys,
  map,
  has,
  omit,
  omitBy,
  forIn,
  toLower,
  uniq,
} from 'lodash';
import { getSortParam } from '../common';
import { uriParser } from '../../../utility';

const formatSourceSchema = (record, view) => {
  const formatted = map(view.fields, (field) => {
    const viewField = field;
    viewField.name = field.displayName;

    if (viewField.dependencyPath) {
      viewField.type = 'relation';
      return viewField;
    }

    const fieldSchema = find(record.fields, { id: field.displayFieldId });
    fieldSchema.name = field.displayName;

    viewField.type = fieldSchema.type;

    return viewField;
  });

  const filteredFields = filter(formatted, field => field.type !== 'primary');

  return filteredFields;
};

const formatResponse = (response) => {
  const responseMetadataFields = response.metadata.schema.fields;
  const fields = response.data;
  const formatedResponse = { metadata: omit(response.metadata, ['schema']), data: [], pagination: response.pagination };
  let formatedField;

  map(fields, (field) => {
    formatedField = {};

    forIn(field, (value, key) => {
      if (has(responseMetadataFields, key)) {
        formatedField[responseMetadataFields[key].displayName] = value;
      }
    });

    formatedResponse.data.push(formatedField);
  });

  return formatedResponse;
};

const getBaseUrl = (connectorOptions, connectorType, type) => {
  const api = connectorType.options.endpoint;
  const serviceEndpoint = api[type];
  const url = `${serviceEndpoint}/spaces/${connectorOptions.space}`;

  return url;
};

const getChangeMethod = (options) => {
  const action = toLower(options.action);
  switch (action) {
    case 'delete':
      return action;
    case 'update':
      return 'patch';
    default:
      return 'post';
  }
};

/*
This will most probably be changed, as it's not certain
yet in which form will the payload be sent from UI components
*/
const getChangePayload = (payload, schema) => {
  if (!payload) return null;

  const change = {};

  each(payload, (value, key) => {
    const schemaField = find(schema, { mapName: key });

    const fieldValue = schemaField.type === 'number' && value
      ? parseFloat(value) : value;
    change[schemaField.displayFieldId] = fieldValue;
  });

  return change;
};

const getInstalledVersions = (baseUrl, versions) => {
  const url = `${baseUrl}/installed-schema-versions`;
  const params = {
    versionIds: versions.join(','),
  };

  return http.get(url, {
    params,
  }).then((response) => {
    const result = response.data;
    return result.data;
  });
};

const getLatestSchema = (baseUrl, dataPackageId) => {
  const latestSchemaUrl = `${baseUrl}/data-packages/${dataPackageId}/schema-versions/uncommitted`;
  return http.get(latestSchemaUrl).then(response => response.data);
};

const getClientParams = (optionParams = {}) => {
  const clientParams = {};

  clientParams.size = optionParams.size || optionParams.pageSize;
  clientParams.page = optionParams.page || optionParams.currentPage;
  clientParams.sort = optionParams.sortBy && optionParams.sortBy.id
    ? getSortParam(optionParams.sort, optionParams.sortBy.id) : null;

  return omitBy(clientParams, isNil);
};

const getSourceDataReqDefinition = (connector, source, options) => {
  const baseUrl = getBaseUrl(
    connector.options,
    connector.type,
    'read',
  );

  const fields = map(source.schema, field => field.id);
  const url = `${baseUrl}/schema-versions/${source.meta.schemaVersion}/records/${source.meta.record}/instances`;
  const params = {
    viewId: source.id,
    fields: JSON.stringify(fields),
    includeFieldMetadata: true,
  };

  assign(params, getClientParams(options.params.pagination));

  if (source.filters && source.filters.length > 0) {
    params.filters = JSON.stringify(source.filters);
  }

  return {
    url,
    params,
  };
};

const getSourceSeedReqDefinition = (connector, source, options) => {
  const api = connector.type.options.endpoint.read;
  const schema = map(source.schema, (field) => {
    const fieldData = {
      name: field.name,
      type: field.type,
      multiValue: field.multiValue,
    };

    return fieldData;
  });

  const params = {
    numRecords: options.params && options.params.numRecords ? options.params.numRecords : 10,
    schema: JSON.stringify({ name: 'test', schema }),
  };

  return {
    url: `${api}/misc/seed`,
    params,
  };
};

const formatViewModels = (views) => {
  // Attach necessary data for READ & WRITE implementation
  const viewModels = map(views, (view) => {
    const viewData = {
      id: view.id,
      name: view.name,
      model: view.name,
      meta: {
        dataPackage: view.dataPackageId,
        dataPackageName: view.dataPackageName,
        record: view.rootRecordId,
        schemaVersion: view.versionId,
        schemaTag: view.versionTag,
      },
    };

    return viewData;
  });

  return keyBy(viewModels, item => item.id);
};

const getSavedViewModels = (viewModels, connector, baseUrl) => {
  const missingVersions = [];
  const result = map(connector.sources, (item) => {
    const source = item;
    const sourceVersion = source.meta.schemaVersion;
    const existsInNew = viewModels[source.id];
    const versionChanged = existsInNew
      ? existsInNew.meta.schemaVersion !== sourceVersion : true;

    source.disabled = !existsInNew;

    if (versionChanged && existsInNew) {
      source.meta.schemaVersions = [{
        schemaVersion: existsInNew.meta.schemaVersion,
        schemaTag: existsInNew.meta.schemaTag,
      }];
    }

    if (!existsInNew || versionChanged) {
      missingVersions.push(sourceVersion);
    }

    return source;
  });

  if (missingVersions.length === 0) {
    return Promise.resolve(result);
  }

  return getInstalledVersions(baseUrl, uniq(missingVersions)).then((versions) => {
    const finalResult = map(result, (item) => {
      const source = item;

      const installedVersion = find(versions, {
        schemaVersion: { versionId: source.meta.schemaVersion },
      });
      const installedSource = installedVersion
        && find(installedVersion.schemaVersion.schema.views, { id: source.id });

      source.installed = !!installedVersion && !!installedSource;
      if (source.installed) {
        source.meta.schemaTag = installedVersion.schemaVersion.versionTag;
      }

      return source;
    });

    return finalResult;
  });
};

const getSourcesRequestParams = (sources, { savedOnly, pagination = {}, search }) => {
  const viewModelNames = search && search.length ? [search] : undefined;

  // When fetching full result set, use incoming pagination
  if (!savedOnly) {
    return {
      page: pagination.page,
      size: pagination.size,
      viewModelNames,
    };
  }

  const sourcesIds = keys(sources);

  // When fetching info about already saved sources,
  // construct new pagination and filter it by view model ids
  return {
    page: 1,
    size: sourcesIds.length,
    viewModelIds: sourcesIds,
    viewModelNames,
  };
};

export default {
  changeSourceData(connector, source, options) {
    const baseUrl = getBaseUrl(connector.options, connector.type, 'write');
    const method = getChangeMethod(options);
    const payload = getChangePayload(options.payload, source.schema);
    let url = `${baseUrl}/schema-versions/${source.meta.schemaVersion}/records/${source.meta.record}`;

    if (payload.recordInstanceId) {
      url += `/instances/${payload.recordInstanceId}`;
    }

    return http[method](url, payload).then((response) => {
      // return result with field names from original payload
      const result = options.payload;
      result.id = response.data.recordInstanceId;

      return result;
    });
  },
  getSources(connector, options) {
    const { savedOnly } = options;
    const requestParams = getSourcesRequestParams(connector.sources, options);
    const baseUrl = getBaseUrl(
      connector.options,
      connector.type,
      'blueprint',
    );

    // Get available view models from all data packages in space
    return http.get(`${baseUrl}/available-view-models`, {
      params: {
        types: ['uncommitted', 'foreign'],
        ...requestParams,
      },
      paramsSerializer: uriParser.encode,
    }).then((response) => {
      const viewModels = response.data.data;
      const formattedViewModels = formatViewModels(viewModels);

      if (savedOnly) {
        return getSavedViewModels(formattedViewModels, connector, baseUrl);
      }

      return {
        data: formattedViewModels,
        pagination: response.data.pagination,
      };
    });
  },
  getSourceData(connector, source, options) {
    const isSeed = options.seed;
    let requestDefinition;

    if (isSeed) {
      requestDefinition = getSourceSeedReqDefinition(connector, source, options);
    } else {
      requestDefinition = getSourceDataReqDefinition(connector, source, options);
    }

    return http.get(requestDefinition.url, {
      params: requestDefinition.params,
      paramsSerializer: uriParser.encode,
    }).then((response) => {
      const result = isSeed ? response.data : formatResponse(response.data);

      return {
        [source.name]: {
          items: result.data,
          metadata: result.metadata, // todo do we need this?
          pagination: result.pagination,
        },
      };
    });
  },
  getSourceSchema(connector, source) {
    let schemaRequest;
    const baseUrl = getBaseUrl(
      connector.options,
      connector.type,
      'blueprint',
    );

    if (source.installed && source.disabled) {
      schemaRequest = getInstalledVersions(baseUrl, [source.meta.schemaVersion]);
    } else {
      schemaRequest = getLatestSchema(baseUrl, source.meta.dataPackage);
    }

    return schemaRequest.then((response) => {
      let result = isArray(response) ? response[0] : response;

      if (result && result.schemaVersion) result = result.schemaVersion;

      const { records, views } = result.schema;
      const viewSchema = find(views, { id: source.id });
      const schema = find(records, { id: source.meta.record });

      return {
        id: source.id,
        schema: formatSourceSchema(schema, viewSchema),
        meta: source.meta,
      };
    });
  },
};
