/// <reference path="../../includes.ts"/>
/// <reference path="kubernetesHelpers.ts"/>

module Kubernetes {

  function byId(thing) {
    return thing.id;
  }

  function createKey(namespace, id) {
    return (namespace || "") + "-" + id;
  }

  function populateKey(item) {
    var result = item;
    result['_key'] = createKey(item.namespace, item.id);
    return result;
  }

  function populateKeys(items:Array<any>) {
    var result = [];
    angular.forEach(items, (item) => {
      result.push(populateKey(item));
    });
    return result;
  }

  function selectPods(pods, namespace, labels) {
    return pods.filter((pod) => {
      return pod.namespace === namespace && selectorMatches(labels, pod.labels);
    });
  }


  /**
   * The object which keeps track of all the pods, replication controllers, services and their associations
   */
  export class KubernetesModelService {
    public kubernetes = null;
    public apps = [];
    public services = [];
    public replicationControllers = [];
    public pods = [];
    public hosts = [];
    public namespaces = [];
    public routes = [];
    public redraw = false;
    public resourceVersions = {};

    // various views on the data
    public podsByHost = {};
    public servicesByKey = {};
    public replicationControllersByKey = {};
    public podsByKey = {};

    public appInfos = [];
    public appViews = [];
    public appFolders = [];

    public fetched = false;
    public isOpenShift = false;

    public fetch = () => {
    };

    public $keepPolling() {
      return keepPollingModel;
    }

    public orRedraw(flag) {
      this.redraw = this.redraw || flag;
    }

    public getService(namespace, id) {
      return this.servicesByKey[createKey(namespace ,id)];
    }

    public getReplicationController(namespace, id) {
      return this.replicationControllersByKey[createKey(namespace ,id)];
    }

    public getPod(namespace, id) {
      return this.podsByKey[createKey(namespace ,id)];
    }

    public podsForNamespace(namespace = this.currentNamespace()) {
      return _.filter(this.pods, { namespace: namespace });
    }

    /**
     * Returns the current selected namespace or the default namespace
     */
    public currentNamespace() {
      var answer = null;
      if (this.kubernetes) {
        answer = this.kubernetes.selectedNamespace;
      }
      return answer || defaultNamespace;
    }

    protected updateIconUrlAndAppInfo(entity, nameField: string) {
      var answer = null;
      var id = entity.id;
      if (id && nameField) {
        (this.appInfos || []).forEach((appInfo) => {
          var iconPath = appInfo.iconPath;
          if (iconPath && !answer && iconPath !== "null") {
            var iconUrl = gitPathToUrl(iconPath);
            var ids = Core.pathGet(appInfo, ["names", nameField]);
            angular.forEach(ids, (appId) => {
              if (appId === id) {
                entity.$iconUrl = iconUrl;
                entity.appPath = appInfo.appPath;
                entity.$info = appInfo;
              }
            });
          }
        });
      }
      if (!entity.$iconUrl) {
        entity.$iconUrl = defaultIconUrl;
      }
    }

    public maybeInit() {
      this.fetched = true;
      if (this.services && this.replicationControllers && this.pods) {
        this.servicesByKey = {};
        this.podsByKey = {};
        this.replicationControllersByKey = {};

        this.pods.forEach((pod) => {
          if (!pod.kind) pod.kind = "Pod";
          this.podsByKey[pod._key] = pod;
          var host = pod.status.host;
          pod.$labelsText = Kubernetes.labelsToString(pod.labels);
          if (host) {
            pod.$labelsText += labelFilterTextSeparator + "host=" + host;
          }
          pod.$iconUrl = defaultIconUrl;
          this.discoverPodConnections(pod);
          pod.$containerPorts = [];
          angular.forEach(Core.pathGet(pod, ["spec", "manifest", "containers"]), (container) => {
            var image = container.image;
            if (image) {
              var idx = image.lastIndexOf(":");
              if (idx > 0) {
                image = image.substring(0, idx);
              }
              var paths = image.split("/", 3);
              if (paths.length) {
                var answer = null;
                if (paths.length == 3) {
                  answer = paths[1] + "/" + paths[2];
                } else if (paths.length == 2) {
                  answer = paths[0] + "/" + paths[1];
                } else {
                  answer = paths[0] + "/" + paths[1];
                }
                container.$imageLink = UrlHelpers.join("https://registry.hub.docker.com/u/", answer);
              }
            }
            angular.forEach(container.ports, (port) => {
              var containerPort = port.containerPort;
              if (containerPort) {
                pod.$containerPorts.push(containerPort);
              }
            });
          });
        });

        this.services.forEach((service) => {
          if (!service.kind) service.kind = "Service";
          this.servicesByKey[service._key] = service;
          var selector = service.selector;
          service.$pods = [];
          if (!service.$podCounters) {
            service.$podCounters = {};
          }
          _.assign(service.$podCounters, selector ? createPodCounters(selector, this.pods, service.$pods) : {});
          var selectedPods = service.$pods;
          service.connectTo = selectedPods.map((pod) => {
            return pod._key;
          }).join(',');
          service.$labelsText = Kubernetes.labelsToString(service.labels);
          this.updateIconUrlAndAppInfo(service, "serviceNames");
          var iconUrl = service.$iconUrl;
          if (iconUrl && selectedPods) {
            selectedPods.forEach((pod) => {
              pod.$iconUrl = iconUrl;
            });
          }
        });

        this.replicationControllers.forEach((replicationController) => {
          if (!replicationController.kind) replicationController.kind = "ReplicationController";
          this.replicationControllersByKey[replicationController._key] = replicationController
          var selector = replicationController.spec.replicaSelector;
          replicationController.$pods = [];
          replicationController.$podCounters = selector ? createPodCounters(selector, this.pods, replicationController.$pods) : null;
          var selectedPods = replicationController.$pods;
          replicationController.connectTo = selectedPods.map((pod) => {
            return pod._key;
          }).join(',');
          replicationController.$labelsText = Kubernetes.labelsToString(replicationController.labels);
          this.updateIconUrlAndAppInfo(replicationController, "replicationControllerNames");
          var iconUrl =  replicationController.$iconUrl;
          if (iconUrl && selectedPods) {
            selectedPods.forEach((pod) => {
              pod.$iconUrl = iconUrl;
            });
          }
        });

        this.updateApps();

        updateNamespaces(this.kubernetes, this.pods, this.replicationControllers, this.services);

        var podsByHost = {};
        this.pods.forEach((pod) => {
          var host = pod.status.host;
          var podsForHost = podsByHost[host];
          if (!podsForHost) {
            podsForHost = [];
            podsByHost[host] = podsForHost;
          }
          podsForHost.push(pod);
        });
        this.podsByHost = podsByHost;

        var tmpHosts = [];
        for (var hostKey in podsByHost) {
          var hostPods = [];
          var podCounters = createPodCounters((pod) => (pod.status || {}).host === hostKey, this.pods, hostPods, "host=" + hostKey);
          var hostIP = null;
          if (hostPods.length) {
            var pod = hostPods[0];
            var currentState = pod.status;
            if (currentState) {
              hostIP = currentState.hostIP;
            }
          }
          var hostDetails = {
            id: hostKey,
            hostIP: hostIP,
            pods: hostPods,
            kind: "Host",
            $podCounters: podCounters,
            $iconUrl: hostIconUrl
          };
          tmpHosts.push(hostDetails);
        }

        this.hosts = tmpHosts;
/*
        tmpHosts.forEach((newHost) => {
          var oldHost:any = this.hosts.find((h) => {
            return h.id === newHost.id
          });
          if (!oldHost) {
            this.redraw = true;
            this.hosts.push(newHost);
          } else {
            this.orRedraw(ArrayHelpers.sync(oldHost.pods, newHost.pods));
          }
        });
*/
      }
    }

    protected updateApps() {
      try {
        // lets create the app views by trying to join controllers / services / pods that are related
        var appViews = [];

        this.replicationControllers.forEach((replicationController) => {
          var name = replicationController.name || replicationController.id;
          var $iconUrl = replicationController.$iconUrl;
          appViews.push({
            appPath: "/dummyPath/" + name,
            $name: name,
            $info: {
              $iconUrl: $iconUrl
            },
            $iconUrl: $iconUrl,
            replicationControllers: [replicationController],
            pods: replicationController.$pods || [],
            services: []
          });
        });

        this.services.forEach((service) => {
          // now lets see if we can find an app with an RC of the same selector
          var matchesApp = null;
          appViews.forEach((appView) => {
            appView.replicationControllers.forEach((replicationController) => {
              var repSelector = Core.pathGet(replicationController, ["spec", "replicaSelector"]);
              if (repSelector && selectorMatches(repSelector, service.selector) && service.namespace == replicationController.namespace) {
                matchesApp = appView;
              }
            });
          });

          if (matchesApp) {
            matchesApp.services.push(service);
          } else {
            var name = service.name || service.id;
            var $iconUrl = service.$iconUrl;
            appViews.push({
              appPath: "/dummyPath/" + name,
              $name: name,
              $info: {
                $iconUrl: $iconUrl
              },
              $iconUrl: $iconUrl,
              replicationControllers: [],
              pods: service.$pods || [],
              services: [service]
            });
          }
        });
        angular.forEach(this.routes, (route) => {
          var metadata = route.metadata || {};
          var serviceName = route.serviceName;
          var host = route.host;
          var namespace = metadata.namespace || defaultNamespace;
          if (serviceName && host) {
            var service = this.getService(namespace, serviceName);
            if (service) {
              service.$host = host;
            } else {
              log.debug("Could not find service " + serviceName + " namespace " + namespace + " for route: " + metadata.name);
            }
          }
        });

        appViews = populateKeys(appViews).sortBy((appView) => appView._key);

        ArrayHelpers.sync(this.appViews, appViews, '$name');

        if (this.appInfos && this.appViews) {
          var folderMap = {};
          var folders = [];
          var appMap = {};
          angular.forEach(this.appInfos, (appInfo) => {
            if (!appInfo.$iconUrl && appInfo.iconPath && appInfo.iconPath !== "null") {
              appInfo.$iconUrl = gitPathToUrl(appInfo.iconPath);
            }
            var appPath = appInfo.appPath;
            if (appPath) {
              appMap[appPath] = appInfo;
              var idx = appPath.lastIndexOf("/");
              var folderPath = "";
              if (idx >= 0) {
                folderPath = appPath.substring(0, idx);
              }
              folderPath = Core.trimLeading(folderPath, "/");
              var folder = folderMap[folderPath];
              if (!folder) {
                folder = {
                  path: folderPath,
                  expanded: true,
                  apps: []
                };
                folders.push(folder);
                folderMap[folderPath] = folder;
              }
              folder.apps.push(appInfo);
            }
          });
          this.appFolders = folders.sortBy("path");

          var apps = [];
          var defaultInfo = {
            $iconUrl: defaultIconUrl
          };

          angular.forEach(this.appViews, (appView) => {
            try {
              var appPath = appView.appPath;

              /*
               TODO
               appView.$select = () => {
               Kubernetes.setJson($scope, appView.id, $scope.model.apps);
               };
               */

              var appInfo = angular.copy(defaultInfo);
              if (appPath) {
                appInfo = appMap[appPath] || appInfo;
              }
              if (!appView.$info) {
                appView.$info = defaultInfo;
                appView.$info = appInfo;
              }
              appView.id = appPath;
              if (!appView.$name) {
                appView.$name = appInfo.name || appView.$name;
              }
              if (!appView.$iconUrl) {
                appView.$iconUrl = appInfo.$iconUrl;
              }
              apps.push(appView);
              appView.$podCounters = createAppViewPodCounters(appView);
              appView.$serviceViews = createAppViewServiceViews(appView);
            } catch (e) {
              log.warn("FAiled to update appViews: " + e);
            }
          });
          //this.apps = apps;
          this.apps = this.appViews;
        }
      } catch (e) {
        log.warn("Caught error: " + e);
      }
    }

    protected discoverPodConnections(entity) {
      var info = Core.pathGet(entity, ["status", "info"]);
      var hostPort = null;
      var currentState = entity.status || {};
      var desiredState = entity.spec || {};
      var podId = entity.id || entity.name;
      var host = currentState["host"];
      var podIP = currentState["podIP"];
      var hasDocker = false;
      var foundContainerPort = null;
      if (desiredState) {
        var containers = Core.pathGet(desiredState, ["manifest", "containers"]);
        angular.forEach(containers, (container) => {
          if (!hostPort) {
            var ports = container.ports;
            angular.forEach(ports, (port) => {
              if (!hostPort) {
                var containerPort = port.containerPort;
                var portName = port.name;
                var containerHostPort = port.hostPort;
                if (containerPort === 8778 || "jolokia" === portName) {
                  if (containerPort) {
                    if (podIP) {
                      foundContainerPort = containerPort;
                    }
                    if (containerHostPort) {
                      hostPort = containerHostPort;
                    }
                  }
                }
              }
            });
          }
        });
      }
      if (isRunning(currentState) && podId && foundContainerPort) {
        entity.$jolokiaUrl = "/kubernetes/api/" + defaultApiVersion + "/proxy/pods/"
        + podId + ":" + foundContainerPort + "/jolokia/";
      }
    }
  }


  /**
   * Creates a model service which keeps track of all the pods, replication controllers and services along
   * with their associations and status
   */
  export function createKubernetesModel($rootScope, $http, AppLibraryURL, KubernetesApiURL, KubernetesState, KubernetesServices, KubernetesReplicationControllers, KubernetesPods) {
    var stableScope = new KubernetesModelService();
    var $scope = new KubernetesModelService();
    $scope.kubernetes = KubernetesState;
    var lastJson = "";


    KubernetesServices.then((KubernetesServices:ng.resource.IResourceClass) => {
      KubernetesReplicationControllers.then((KubernetesReplicationControllers:ng.resource.IResourceClass) => {
        KubernetesPods.then((KubernetesPods:ng.resource.IResourceClass) => {
          $scope.fetch = PollHelpers.setupPolling($scope, (next:() => void) => {
            var ready = 0;
            var numServices = 5;
            var dataChanged = false;
            var changedResourceVersion = null;

            function maybeNext(count) {
              ready = count;
              // log.debug("Completed: ", ready);
              if (ready >= numServices) {
                // log.debug("Fetching another round");
                if (dataChanged) {
                  $scope.maybeInit();
                  log.debug("kube model changed resourceVersion: " + changedResourceVersion);
                  // lets check if things really changed.

                  var trimmedScope = _.cloneDeep($scope);
                  // it looks like the resource versions change a lot whereas the data often doesn't ;)
                  delete trimmedScope["resourceVersions"];
                  var newJson = angular.toJson(trimmedScope, true);
                  if (lastJson !== newJson) {
                    //log.debug("Kube model changed, old: ", lastJson, " new: ", newJson);
                    lastJson = newJson;
                    _.forIn(trimmedScope, (value, prop) => {
                      if (_.isArray(value)) {
                        ArrayHelpers.sync(stableScope[prop], trimmedScope[prop], '_key');
                      } else {
                        stableScope[prop] = trimmedScope[prop];
                      }
                    });
                  }
                }
                next();
              }
            }

            function hasChanged(response, name) {
              var resourceVersion = response.resourceVersion;
              var lastResourceVersion = $scope.resourceVersions[name] || 0;
              if (!resourceVersion || resourceVersion > lastResourceVersion) {
                if (resourceVersion) {
                  $scope.resourceVersions[name] = resourceVersion;
                  changedResourceVersion = resourceVersion;
                }
                dataChanged = true;
                return true;
              }
              return false;
            }

            KubernetesServices.query((response) => {
              if (response && hasChanged(response, "services")) {
                var items = populateKeys((response.items || []).sortBy(byId));
                angular.forEach(items, (item) => {
                  kubernetesProxyUrlForService(KubernetesApiURL, item).then((url) => {
                    item.proxyUrl = url;
                  });
                });
                $scope.services = items;
              }
              maybeNext(ready + 1);
            });
            KubernetesReplicationControllers.query((response) => {
              if (response && hasChanged(response, "replicationControllers")) {
                var items = populateKeys((response.items || []).sortBy(byId));
                $scope.replicationControllers = items;
              }
              maybeNext(ready + 1);
            });
            KubernetesPods.query((response) => {
              if (response && hasChanged(response, "pods")) {
                var items = populateKeys((response.items || []).sortBy(byId));
                $scope.pods = items;
              }
              maybeNext(ready + 1);
            });

            // lets see if we can find the app-library service
            var hasAppLibrary = false;
            angular.forEach($scope.services, (service) => {
              var metadata = service.metadata;
              if (metadata) {
                var name = metadata.name;
                if (name && name === "app-library") {
                  hasAppLibrary = true;
                }
              }
            });
            if (hasAppLibrary) {
              var appsUrl = AppLibraryURL + "/apps";
              console.log("has app library so lets query: " + appsUrl);
              var etags = $scope.resourceVersions["appLibrary"];
              $http.get(appsUrl, {
                headers: {
                  "If-None-Match": etags
                }
              }).
                success(function (data, status, headers, config) {
                  if (angular.isArray(data) && status === 200) {
                    var newETags = headers("etag") || headers("ETag");
                    if (!newETags || newETags !== etags) {
                      if (newETags) {
                        $scope.resourceVersions["appLibrary"] = newETags;
                      }
                      $scope.appInfos = data;
                      dataChanged = true;
                    }
                  }
                  maybeNext(ready + 1);
                }).
                error(function (data, status, headers, config) {
                  maybeNext(ready + 1);
                });
            } else {
              maybeNext(ready + 1);
            }

            var url = routesRestURL();
            $http.get(url).
              success(function (data, status, headers, config) {
                if (data) {
                  $scope.routes = data.items;
                  $scope.isOpenShift = true;
                  maybeNext(ready + 1);
                }
              }).
              error(function (data, status, headers, config) {
                log.warn("Failed to load " + url + " " + data + " " + status);
                maybeNext(ready + 1);
              });

          });
          $scope.fetch();
        });
      });
      return stableScope;
    });

    function selectPods(pods, namespace, labels) {
      return pods.filter((pod) => {
        return pod.namespace === namespace && selectorMatches(labels, pod.labels);
      });
    }
    return $scope;
  }

}
