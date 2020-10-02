/* See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * Esri Inc. licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
define(["dojo/_base/declare",
        "dojo/_base/lang",
        "dojo/_base/array",
        "dojo/dom-construct",
        "dojo/topic",
        "app/context/app-topics",
        "dojo/store/Memory",
        "dojo/store/Observable",
        "dijit/tree/ObjectStoreModel", 
        "dijit/Tree",
        "dojo/text!./templates/HierarchyTree.html",
        "dojo/i18n!app/nls/resources",
        "app/search/SearchComponent",
        "app/search/DropPane",
        "app/search/QClause",
        "app/search/HierarchyTreeSettings"], 
function(declare, lang, array, domConstruct, topic, appTopics, Memory, Observable, ObjectStoreModel, Tree, template, i18n, SearchComponent, 
  DropPane, QClause, HierarchyTreeSettings) {
  
  var oThisClass = declare([SearchComponent], {
    
    i18n: i18n,
    templateString: template,
    
    allowSettings: null,
    field: null,
    label: null,
    open: false,
    props: null,
    
    _initialSettings: null,
    
    // tree structures
    store: null,
    observableStore: null,
    model: null,
    tree: null,
    
    constructor: function() {
      this.inherited(arguments);
      
      this.store = new Memory({
          data: [ {id: "root"} ],
          getChildren: function(object){
              return this.query({parent: object.id});
          }
      });
      
      this.observableStore = new Observable(this.store);
      
      this.model = new ObjectStoreModel({
          store: this.observableStore,
          query: {id: 'root'}
      });
      
      this.tree =  new Tree({
          model: this.model,
          showRoot: false,
          onClick: lang.hitch(this, function(item){
            if (item.count) {
              var name = this.chkName(item.id);
              var tipPattern = i18n.search.appliedFilters.tipPattern;
              var tip = tipPattern.replace("{type}",this.label).replace("{value}",name);
              
              var query = {"term": {}};
              query.term[this.field] = item.id;
              var qClause = new QClause({
                label: name,
                tip: tip,
                parentQComponent: this,
                removable: true,
                scorable: true,
                query: query
              });
              
              this.pushQClause(qClause,true)
            }
          })
      });
    },
    
    postCreate: function() {
      this.inherited(arguments);
      
      this._initialSettings = {
        label: this.label,
        field: this.field
      };
      if (this.props) {
        this._initialSettings.props = lang.clone(this.props);
      }
      
      if (this.allowSettings === null) {
        if (AppContext.appConfig.search && !!AppContext.appConfig.search.allowSettings) {
          this.allowSettings = true;
        }
      }
      if (this.allowSettings) {
        var link = this.dropPane.addSettingsLink();
        link.onclick = lang.hitch(this,function(e) {
          var d = new HierarchyTreeSettings({
            targetWidget: this
          });
          d.showDialog();
        });
      }
      
      this.own(topic.subscribe(appTopics.AppStarted, lang.hitch(this, function() {
        this.tree.placeAt(this.entriesNode);
        this.tree.startup();
      })));
    },
    
    postMixInProperties: function() {
      this.inherited(arguments);
      if (typeof this.label === "undefined" || this.label === null || this.label.length === 0) {
        this.label = this.field;
      }
    },
    
    chkName: function(term){
      var name = term;
      if (this.field === "sys_access_groups_s" && typeof name === "string" &&
          AppContext.geoportal.supportsGroupBasedAccess) {
        array.some(AppContext.appUser.getGroups(),function(group){
          if (group.id === name) {
            name = group.name;
            return true;
          }
        });
      }
      return name;
    },
    
    hasField: function() {
      return (typeof this.field !== "undefined" && this.field !== null && this.field.length > 0);
    },
    
    /* SearchComponent API ============================================= */
    
    appendQueryParams: function(params) {
      if (!this.hasField()) return;
      this.appendQClauses(params);
      
      if (!params.aggregations) params.aggregations = {};
      var key = this.getAggregationKey();
      var props = {"field":this.field};
      if (typeof this.props !== "undefined" && this.props !== null) {
        delete this.props.field; // TODO ??
        lang.mixin(props,this.props);
      }
      params.aggregations[key] = {"terms":props};
    },
    
    processResults: function(searchResponse) {
      var key = this.getAggregationKey();
      if (searchResponse.aggregations) {
        var data = searchResponse.aggregations[key];
        if (data && data.buckets) {
          
          var v, missingVal = null;
          if (this.props && typeof this.props.missing === "string") {
            v = lang.trim(this.props.missing);
            if (v.length > 0) missingVal = v;
          }
          
          // build tree structure
          var root = { id: "root", parent: null };
          
          findPath = function(element) {
            var parentPath = element.parent? findPath(element.parent): null;
            return parentPath!=null? parentPath + "|" + element.id: element.id;
          }
          
          array.forEach(data.buckets,function(entry){
            var parts = entry.key.split("|");
            var head = root;
            
            parts.forEach(part => {
              if (!head[part]) {
                head[part] = {
                  parentNode: head,
                  parent: head.id,
                  id: (head.parent? head.id + "|": "") + part,
                  name: part
                };
              }
              head = head[part];
            }, this);
            
            head.count = entry.doc_count;
          });
          
          // clear tree widget
          this.observableStore.data.filter(node => node.id != root.id).forEach(child => this.observableStore.remove(child.id))
          
          // create content of the tree widget
          addContent = lang.hitch(this, function(root) {
            Object.keys(root).filter(e => ["id", "name", "parent", "parentNode", "count"].indexOf(e) < 0).forEach(key => {
              var element = root[key];
              this.observableStore.add({
                id: element.id,
                name: element.name + (element.count? " ("+element.count+")": ""),
                parent: element.parent,
                count: element.count
              });
              addContent(element);
            });
          });
          
          addContent(root);
        }
      }
    }
    
  });
  
  return oThisClass;
});