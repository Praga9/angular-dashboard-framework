/*
 * The MIT License
 *
 * Copyright (c) 2015, Sebastian Sdorra
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * @ngdoc directive
 * @name adf.directive:adfDashboard
 * @element div
 * @restrict EA
 * @scope
 * @description
 *
 * `adfDashboard` is a directive which renders the dashboard with all its
 * components. The directive requires a name attribute. The name of the
 * dashboard can be used to store the model.
 *
 * @param {string} name name of the dashboard. This attribute is required.
 * @param {boolean=} editable false to disable the editmode of the dashboard.
 * @param {boolean=} collapsible true to make widgets collapsible on the dashboard.
 * @param {boolean=} maximizable true to add a button for open widgets in a large modal panel.
 * @param {boolean=} enableConfirmDelete true to ask before remove an widget from the dashboard.
 * @param {string=} structure the default structure of the dashboard.
 * @param {object=} adfModel model object of the dashboard.
 * @param {function=} adfWidgetFilter function to filter widgets on the add dialog.
 * @param {boolean=} continuousEditMode enable continuous edit mode, to fire add/change/remove
 *                   events during edit mode not reset it if edit mode is exited.
 */

angular.module('adf')
  .directive('adfDashboard', function ($rootScope, $log, $timeout, $uibModal, dashboard, adfTemplatePath) {
    'use strict';

    function stringToBoolean(string){
      switch(angular.isDefined(string) ? string.toLowerCase() : null){
        case 'true': case 'yes': case '1': return true;
        case 'false': case 'no': case '0': case null: return false;
        default: return Boolean(string);
      }
    }

    function copyWidgets(source, target) {
      if ( source.widgets && source.widgets.length > 0 ){
        var w = source.widgets.shift();
        while (w){
          target.widgets.push(w);
          w = source.widgets.shift();
        }
      }
    }

    /**
     * Copy widget from old columns to the new model
     * @param object root the model
     * @param array of columns
     * @param counter
     */
    function fillStructure(root, columns, counter) {
      counter = counter || 0;

      if (angular.isDefined(root.rows)) {
        angular.forEach(root.rows, function (row) {
          angular.forEach(row.columns, function (column) {
            // if the widgets prop doesn't exist, create a new array for it.
            // this allows ui.sortable to do it's thing without error
            if (!column.widgets) {
              column.widgets = [];
            }

            // if a column exist at the counter index, copy over the column
            if (angular.isDefined(columns[counter])) {
              // do not add widgets to a column, which uses nested rows
              if (angular.isUndefined(column.rows)){
                copyWidgets(columns[counter], column);
                counter++;
              }
            }

            // run fillStructure again for any sub rows/columns
            counter = fillStructure(column, columns, counter);
          });
        });
      }
      return counter;
    }

    /**
    * Read Columns: recursively searches an object for the 'columns' property
    * @param object model
    * @param array  an array of existing columns; used when recursion happens
    */
    function readColumns(root, columns) {
      columns = columns || [];

      if (angular.isDefined(root.rows)) {
        angular.forEach(root.rows, function (row) {
          angular.forEach(row.columns, function (col) {
            columns.push(col);
            // keep reading columns until we can't any more
            readColumns(col, columns);
          });
        });
      }

      return columns;
    }

    function changeStructure(model, structure){
      var columns = readColumns(model);
      var counter = 0;

      model.rows = angular.copy(structure.rows);

      while ( counter < columns.length ){
        counter = fillStructure(model, columns, counter);
      }
    }

    function createConfiguration(type){
      var cfg = {};
      var config = dashboard.widgets[type].config;
      if (config){
        cfg = angular.copy(config);
      }
      return cfg;
    }

    /**
     * Find first widget column in model.
     *
     * @param dashboard model
     */
    function findFirstWidgetColumn(model){
      var column = null;
      if (!angular.isArray(model.rows)){
        $log.error('model does not have any rows');
        return null;
      }
      for (var i=0; i<model.rows.length; i++){
        var row = model.rows[i];
        if (angular.isArray(row.columns)){
          for (var j=0; j<row.columns.length; j++){
            var col = row.columns[j];
            if (!col.rows){
              column = col;
              break;
            }
          }
        }
        if (column){
          break;
        }
      }
      return column;
    }

    /**
     * Adds the widget to first column of the model.
     *
     * @param dashboard model
     * @param widget to add to model
     * @param name name of the dashboard
     */
    function addNewWidgetToModel(model, widget, name, column){
      if (model){
        if(!column) {
          column = findFirstWidgetColumn(model);
        }
        if (column){
          if (!column.widgets){
            column.widgets = [];
          }
          column.widgets.unshift(widget);

          // broadcast added event
          $rootScope.$broadcast('adfWidgetAdded', name, model, widget);
        } else {
          $log.error('could not find first widget column');
        }
      } else {
        $log.error('model is undefined');
      }
    }

    /**
     * Checks if the edit mode of the widget should be opened immediately.
     *
     * @param widget type
     */
    function isEditModeImmediate(type){
      var widget = dashboard.widgets[type];
      return widget && widget.edit && widget.edit.immediate;
    }

    /**
     * Opens the edit mode of the specified widget.
     *
     * @param dashboard scope
     * @param widget
     */
    function openEditMode($scope, widget){
      // wait some time before fire enter edit mode event
      $timeout(function(){
        $scope.$broadcast('adfWidgetEnterEditMode', widget);
      }, 200);
    }

    /**
     * finds a widget by its id in the column
     */
    function findWidget(column, index){
      var widget = null;
      for (var i=0; i<column.widgets.length; i++){
        var w = column.widgets[i];
        if (dashboard.idEquals(w.wid,index)){
          widget = w;
          break;
        }
      }
      return widget;
    }

    /**
     * finds a column by its id in the model
     */
    function findColumn(model, index){
      var column = null;
      for (var i=0; i<model.rows.length; i++){
        var r = model.rows[i];
        for (var j=0; j<r.columns.length; j++){
          var c = r.columns[j];
          if (dashboard.idEquals(c.cid, index)){
            column = c;
            break;
          } else if (c.rows){
            column = findColumn(c, index);
          }
        }
        if (column){
          break;
        }
      }
      return column;
    }

    /**
     * Finds widget by id and changes its config
     */
    function changeConfigForWidgetById($scope, wid, config, widgetType, widgetTitle){
      var model = $scope.model,
        rows = model.rows,
        widgetForUpdate = null;

      if(rows){
        angular.forEach(rows, function(row){
          var columns = row.columns;

          if(columns){
            angular.forEach(columns, function(column){
              var widgets = column.widgets;

              if(widgets){
                angular.forEach(widgets, function (widget, key) {

                  if( widget.wid === wid ){
                    widgetForUpdate = widget;
                  }
                });
              }
            });
          }
        });
      }

      if (widgetForUpdate) {
        // If widgetType is defined and it is not equal to previous type, create config for new type of widget.
        if (widgetType && widgetType !== widgetForUpdate.type) {
          var defConfig = createConfiguration(widgetType);
          widgetForUpdate.config = angular.extend({}, defConfig, config);
          widgetForUpdate.type = widgetType;
          widgetForUpdate.wid = dashboard.id();
        }
        else {
          widgetForUpdate.config = angular.extend({}, widgetForUpdate.config, config);
        }

        if (widgetTitle) {
          widgetForUpdate.title = widgetTitle;
        }
      }
    }

    function setExternalApiFunctions(scope) {
      var api = {};

      api.saveDashboard = function() {
        return scope.saveDashboard();
      };

      api.manageEditMode = function() {
        return scope.manageEditMode();
      };

      api.editDashboardDialog = function() {
        return scope.editDashboardDialog();
      };

      api.cancelEditMode = function() {
        return scope.cancelEditMode();
      };

      api.changeDashStructure = function(name, structure) {
        scope.changeStructure(name, structure, scope);
      };

      api.triggerDashboardChanged = function() {
        scope.triggerDashboardChanged();
      };

      api.addNewWidget = function(config, type, name) {
        var defConfig = createConfiguration(type);

        var widgetName = name ? name : '',
          model = scope.model,
          widget = {
          type: type,
          config: angular.extend({}, defConfig, config),
          wid: dashboard.id(),
          title: widgetName
        };

        addNewWidgetToModel(model, widget, widgetName);

        scope.triggerDashboardChanged();
      };

      api.changeWidgetConfig = function(wid, config, type, title) {
        changeConfigForWidgetById(scope, wid, config, type, title);

        scope.$broadcast('adfWidgetConfigChanged', wid);

        scope.triggerDashboardChanged();
      };

      scope.externalApi = api;
    }

    return {
      replace: true,
      restrict: 'EA',
      transclude : false,
      scope: {
        structure: '@',
        name: '@',
        collapsible: '@',
        editable: '@',
        editMode: '@',
        continuousEditMode: '=',
        maximizable: '@',
        adfModel: '=',
        adfWidgetFilter: '=',
        externalApi: '='
      },
      controller: function($scope){
        var model = {};
        var structure = {};
        var widgetFilter = null;
        var structureName = {};
        var name = $scope.name;

        // Watching for changes on adfModel
        $scope.$watch('adfModel', function(oldVal, newVal) {
          // has model changed or is the model attribute not set
          if (newVal !== null || (oldVal === null && newVal === null)) {
            model = $scope.adfModel;
            widgetFilter = $scope.adfWidgetFilter;
            if ( ! model || ! model.rows ){
              structureName = $scope.structure;
              structure = dashboard.structures[structureName];
              if (structure){
                if (model){
                  model.rows = angular.copy(structure).rows;
                } else {
                  model = angular.copy(structure);
                }
                model.structure = structureName;
              } else {
                $log.error( 'could not find structure ' + structureName);
              }
            }

            if (model) {
              if (!model.title){
                model.title = 'Dashboard';
              }
              if (!model.titleTemplateUrl) {
                model.titleTemplateUrl = adfTemplatePath + 'dashboard-title-custom.html';
              }
              $scope.model = model;
            } else {
              $log.error('could not find or create model');
            }
          }
        }, true);

        // edit mode
        $scope.editMode = false;
        $scope.editClass = '';

        $scope.toggleEditMode = function(){
          $scope.editMode = ! $scope.editMode;
          if ($scope.editMode){
            if (!$scope.continuousEditMode) {
              $scope.modelCopy = angular.copy($scope.adfModel, {});
              $rootScope.$broadcast('adfIsEditMode');
            }
          }

          if (!$scope.editMode){
             $scope.triggerDashboardChanged();
          }
        };

        $scope.$on('adfToggleEditMode', function() {
            $scope.toggleEditMode();
        });

        $scope.collapseAll = function(collapseExpandStatus){
          $rootScope.$broadcast('adfDashboardCollapseExpand',{collapseExpandStatus : collapseExpandStatus});
        };

        $scope.cancelEditMode = function(){
          $scope.editMode = false;
          if (!$scope.continuousEditMode) {
            $scope.modelCopy = angular.copy($scope.modelCopy, $scope.adfModel);
          }
          $rootScope.$broadcast('adfDashboardEditsCancelled');
        };

        // edit dashboard settings
        $scope.editDashboardDialog = function(){
          var editDashboardScope = $scope.$new();
          // create a copy of the title, to avoid changing the title to
          // "dashboard" if the field is empty
          editDashboardScope.copy = {
            title: model.title
          };
          editDashboardScope.structures = dashboard.structures;

          var adfEditTemplatePath = adfTemplatePath + 'dashboard-edit.html';
          if(model.editTemplateUrl) {
            adfEditTemplatePath = model.editTemplateUrl;
          }
          var instance = $uibModal.open({
            scope: editDashboardScope,
            templateUrl: adfEditTemplatePath,
            backdrop: 'static'
          });
          editDashboardScope.changeStructure = function(name, structure){
            $log.info('change structure to ' + name);
            changeStructure(model, structure, $scope);
          };
          editDashboardScope.closeDialog = function(){
            // copy the new title back to the model
            model.title = editDashboardScope.copy.title;
            // close modal and destroy the scope
            instance.close();
            editDashboardScope.$destroy();
          };
        };

        // add widget dialog
        $scope.addWidgetDialog = function(column){
          var addScope = $scope.$new();
          var model = $scope.model;
          var widgets;
          if (angular.isFunction(widgetFilter)){
            widgets = {};
            angular.forEach(dashboard.widgets, function(widget, type){
              if (widgetFilter(widget, type, model, column)){
                widgets[type] = widget;
              }
            });
          } else {
            widgets = dashboard.widgets;
          }
          addScope.widgets = widgets;
          addScope.noWidgetsAvailable = angular.equals({}, widgets);

          var adfAddTemplatePath = adfTemplatePath + 'widget-add.html';
          if(model.addTemplateUrl) {
            adfAddTemplatePath = model.addTemplateUrl;
          }

          var opts = {
            scope: addScope,
            templateUrl: adfAddTemplatePath,
            backdrop: 'static'
          };

          var instance = $uibModal.open(opts);
          addScope.addWidget = function(widget){
            var w = {
              type: widget,
              config: createConfiguration(widget),
              wid: dashboard.id()
            };
            addNewWidgetToModel(model, w, name, column);
            // close and destroy
            instance.close();
            addScope.$destroy();

            // check for open edit mode immediately
            if (isEditModeImmediate(widget)){
              openEditMode($scope, w);
            }

            $scope.triggerDashboardChanged();
          };
          addScope.closeDialog = function(){
            // close and destroy
            instance.close();
            addScope.$destroy();
          };
        };

        $scope.manageEditMode = function () {
          $scope.editMode = !$scope.editMode;
          if ($scope.editMode){
            $scope.modelCopy = angular.copy($scope.adfModel, {});
          }
          return $scope.editMode;
        };

        $scope.saveDashboard = function() {
          $scope.editMode = false;
          $scope.triggerDashboardChanged();
          return false;
        };

        $scope.changeStructure = function(name, structure) {
          changeStructure(model, structure, $scope);
        };

        $scope.triggerDashboardChanged = function() {
          $rootScope.$broadcast('adfDashboardChanged', name, model);
        };

        $scope.addNewWidgetToModel = addNewWidgetToModel;

        $scope.$on('addWidgetDialog', function(event, column) {
          $scope.addWidgetDialog(column);
        });

        $scope.$on('dashboardWidgetChanged', function() {
          // the event should only be caught by dashboard directive, that's why it is not propagated further up the chain
          event.stopPropagation();

          $scope.triggerDashboardChanged();
        });

        $scope.$on('dashboardWidgetConfigUpdated', function(event, config, wid, cid) {
          // the event should only be caught by dashboard directive, that's why it is not propagated further up the chain
          event.stopPropagation();

          // we need to overwrite config object before saving to database, otherwise it is set after saving so the changed data is lost
          if(cid) {
            var col = findColumn(model, cid);
            if(wid && col) {
              var widget = findWidget(col, wid);
              if(widget) {
                widget.config = config;
                $scope.triggerDashboardChanged();
              }
            }
          }
        });

        setExternalApiFunctions($scope);
      },
      link: function ($scope, $element, $attr) {
        // pass options to scope
        var options = {
          name: $attr.name,
          editable: true,
          enableConfirmDelete: stringToBoolean($attr.enableconfirmdelete),
          maximizable: stringToBoolean($attr.maximizable),
          collapsible: stringToBoolean($attr.collapsible)
        };
        if (angular.isDefined($attr.editable)){
          options.editable = stringToBoolean($attr.editable);
        }
        $scope.options = options;
      },
      templateUrl: adfTemplatePath + 'dashboard.html'
    };
  });
