/*
This mixin provides `loadDependencies` method that checks if
required library for component is loaded (for example youtube API).
Mixin sets global flags to make sure dependencies are loaded only once.
*/
import {
  isArray,
  isUndefined,
  merge,
  map,
} from 'lodash';

let globalDeps = null;

const isGlobalAvailable = (dep) => {
  if (dep.indexOf('.') < 0) {
    return !!window[dep];
  }

  // Handle dot notation, e.g. google.maps
  const parts = dep.split('.');
  return !!window[parts[0]] && !!window[parts[0]][parts[1]];
};

const setGlobal = (context) => {
  const deps = context.options.bundle || 'material';
  globalDeps = `__CHAMELEON_${deps.toUpperCase()}_DEPS__`;

  window[globalDeps] = window[globalDeps] || {};
};

const setFlag = (global, prop, value) => {
  merge(window[globalDeps], {
    [global]: {
      [prop]: value,
    },
  });
};

const startAvailabilityInterval = (dep, resolve, reject) => {
  const availabilityInterval = setInterval(() => {
    if (isGlobalAvailable(dep)) {
      resolve();
      setFlag(dep, 'loading', false);
      clearInterval(availabilityInterval);
    } else if (window[globalDeps][dep].rejected) {
      reject();
      clearInterval(availabilityInterval);
    }
  }, 100);
};

const addDependency = (url, globals) => {
  const type = url.type === 'script' || isUndefined(url.type) ? 'script' : 'link';
  const attr = url.type === 'script' || isUndefined(url.type) ? 'src' : 'href';
  const resource = document.createElement(type);

  resource.setAttribute(attr, url.src || url);

  if (type === 'script') {
    document.body.appendChild(resource);
  } else if (url.type === 'link') {
    resource.rel = 'stylesheet';
    resource.type = 'text/css';
    document.head.appendChild(resource);
  }

  return new Promise((resolve, reject) => {
    resource.onerror = () => {
      reject();
      setFlag(globals, 'rejected', true);
    };

    resource.onload = () => {
      if (type === 'link' || (type !== 'link' && isGlobalAvailable(globals))) {
        // Resolve stylesheets and registered global variables
        resolve();
      } else {
        // Schedule checks for unregistered global variables
        startAvailabilityInterval(globals, resolve, reject);
      }
    };
  });
};

const initDependencies = (url, globals) => {
  const items = isArray(url) ? url : [url];
  const promises = map(items, item => addDependency(item, globals));

  return Promise.all(promises);
};

export default {
  methods: {
    loadDependencies(srcs, dep) {
      return new Promise((resolve, reject) => {
        if (!window[globalDeps][dep]) {
          // Start dependency intialization
          setFlag(dep, 'loading', true);
          initDependencies(srcs, dep).then(() => {
            resolve();
            setFlag(dep, 'loading', false);
          }).catch((error) => {
            console.warn('[CSDK] Script rejected =>', error);
          });
        } else if (isGlobalAvailable(dep)) {
          // Resolve if global vairable is registered
          setFlag(dep, 'loading', false);
          resolve();
        } else {
          // Schedule checks if global variable is unregistered
          startAvailabilityInterval(dep, resolve, reject);
        }
      });
    },
  },
  beforeMount() {
    setGlobal(this);
  },
};