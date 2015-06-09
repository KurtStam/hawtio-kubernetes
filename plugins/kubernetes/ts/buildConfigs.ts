/// <reference path="../../includes.ts"/>
/// <reference path="kubernetesPlugin.ts"/>

module Kubernetes {

  export var BuildConfigsController = controller("BuildConfigsController", ["$scope", "KubernetesModel", "KubernetesBuilds", "KubernetesState", "$dialog", "$window", "$templateCache", "$routeParams", "$location", "localStorage", "$http", "$timeout", "KubernetesApiURL",
    ($scope, KubernetesModel:Kubernetes.KubernetesModelService, KubernetesBuilds, KubernetesState, $dialog, $window, $templateCache, $routeParams, $location:ng.ILocationService, localStorage, $http, $timeout, KubernetesApiURL) => {

      $scope.kubernetes = KubernetesState;
      $scope.model = KubernetesModel;
      $scope.KubernetesBuilds = KubernetesBuilds;
      $scope.$on('kubernetesModelUpdated', function () {
        Core.$apply($scope);
      });

      $scope.tableConfig = {
        data: 'buildConfigs',
        showSelectionCheckbox: true,
        enableRowClickSelection: false,
        multiSelect: true,
        selectedItems: [],
        filterOptions: {
          filterText: $location.search()["q"] || ''
        },
        columnDefs: [
          {
            field: 'metadata.name',
            displayName: 'Name',
            cellTemplate: $templateCache.get("buildConfigLinkTemplate.html")
          },
/*
          {
            field: 'spec.source.type',
            displayName: 'Source'
          },
*/
          {
            field: 'spec.source.git.uri',
            displayName: 'Repository'
          },
/*
          {
            field: 'spec.strategy.type',
            displayName: 'Strategy'
          },
*/
          {
            field: 'spec.strategy.stiStrategy.image',
            displayName: 'Source Image'
          },
          {
            field: 'spec.output.imageTag',
            displayName: 'Output Image'
          },
          {
            field: '$fabric8Views',
            displayName: 'Views',
            width: "***",
            minWidth: 500,
            cellTemplate: $templateCache.get("buildConfigViewsTemplate.html")
          }
        ]
      };

      Kubernetes.initShared($scope, $location, $http, $timeout, $routeParams, KubernetesModel, KubernetesState, KubernetesApiURL);

      $scope.isLoggedIntoGogs = Forge.isLoggedIntoGogs;

      $scope.deletePrompt = (selected) => {
        UI.multiItemConfirmActionDialog(<UI.MultiItemConfirmActionOptions>{
          collection: selected,
          index: '$name',
          onClose: (result:boolean) => {
            if (result) {
              function deleteSelected(selected, next) {
                if (next) {
                  deleteEntity(next, () => {
                    deleteSelected(selected, selected.shift());
                  });
                } else {
                  updateData();
                }
              }

              deleteSelected(selected, selected.shift());
            }
          },
          title: 'Delete Build Configs?',
          action: 'The following Build Configs will be deleted:',
          okText: 'Delete',
          okClass: 'btn-danger',
          custom: "This operation is permanent once completed!",
          customClass: "alert alert-warning"
        }).open();
      };

      function deleteEntity(selection, nextCallback) {
        var name = (selection || {}).$name;
        if (name) {
          console.log("About to delete build config: " + name);
          var url = buildConfigRestUrl(name);
          $http.delete(url).
            success(function (data, status, headers, config) {
              nextCallback();
            }).
            error(function (data, status, headers, config) {
              log.warn("Failed to delete build config on " + url + " " + data + " " + status);
            });
        } else {
          console.log("warning: no name for selection: " + angular.toJson(selection));
        }
      }

      function updateData() {
        var url = buildConfigsRestURL();
        $http.get(url).
          success(function (data, status, headers, config) {
            if (data) {
              //console.log("got data " + angular.toJson(data, true));
              var sortedBuilds = null;
              $scope.buildConfigs = enrichBuildConfigs(data.items, sortedBuilds);
              $scope.fetched = true;
              Core.$apply($scope);
            }
          }).
          error(function (data, status, headers, config) {
            log.warn("Failed to load " + url + " " + data + " " + status);
          });
      }

      updateData();
    }]);
}
