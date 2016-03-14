DB.prototype.indexStats = function() {
  var queries = [];
  var collections = db.getCollectionNames();
  // this could probably be made better, caching by index used instead of exact query
  // (because queries on _id for example can be all over the place)
  var findQuery = function(q) {
    for(entryIdx in queries) {
      if(q == queries[entryIdx].query) {
        return entryIdx;
      }
    }
    return -1;
  }

  // perform an explain on the query or aggregation
  var getExplain = function(collection, cachedQuery, query) {
    var explain = collection.find(cachedQuery.query).explain();
    if(query && query["query"]) {
      cachedQuery.sort = query['orderby'];
      if(cachedQuery.sort) {
        explain = collection.find(cachedQuery.query.query).sort(cachedQuery.sort).explain();
      }
    }
    return explain;
  }

 // search through inputStage's for indexes
 var findIndexes = function(plan) {
   if(plan.inputStage) {
     if(plan.inputStage.indexName) {
       return {
         stage: plan.inputStage.stage,
         indexName: plan.inputStage.indexName
       };
     } else {
       return findIndexes(plan.inputStage);
     }
   } else {
     return {
       stage: plan.stage
     };
   }
 }

  // process the query, figure out if we've seen it already, if not check the
  // the explain details
  var queryProcessor = function(query, queries, nsName) {
    var qIdx = findQuery(query);
    if(qIdx == -1) {
      var size = queries.push({query:query, count:1, index:""});
      var explain = getExplain(db[cName], queries[size-1], query);

      // Find if there are indexes used, and stages without indexes
      var indexes = findIndexes(explain.queryPlanner.winningPlan);
      if(indexes.indexName) {
        queries[size-1].index = indexes.indexName;
      } else {
        print('warning, no index for query {ns:"'+nsName+'"}: ');
        print("... scan type (stage): " + indexes.stage);
        printjson(query);
      }
    } else {
      queries[qIdx].count++;
    }
  }

  for(cIdx in collections) {
    var cName = collections[cIdx];
    var nsName = db.getName()+"."+cName;
    if(cName.indexOf("system") == -1) {
      var i = 1;
      var count = db.system.profile.count({ns:nsName});
      print('scanning profile {ns:"'+nsName+'"} with '+count+" records... this could take a while.");
      db.system.profile.find({op: 'command', ns:db.getName()+'.$cmd', 'command.aggregate':cName}).addOption(16).batchSize(10000).forEach(function(profileDoc) {
        if(!profileDoc.command.explain) {
          profileDoc.command.pipeline.forEach(function(pipeline) {
            // We're only interested in the match pipelines
            if(pipeline["$match"]) {
              queryProcessor(pipeline["$match"], queries, nsName);
            }
          });
        }
      });
      db.system.profile.find({op:'query', ns:nsName}).addOption(16).batchSize(10000).forEach(function(profileDoc) {
        if(!profileDoc.query["$explain"]) {
          queryProcessor(profileDoc.query, queries, nsName);
        }
      });
    }
  }

  for(cIdx in collections) {
    var cName = collections[cIdx];
    if(cName.indexOf("system") == -1) {
      print("checking for unused indexes in: " + cName);
      for(iIdx in db[cName].getIndexes()) {
        var iName = db[cName].getIndexes()[iIdx].name;
        if(iName.indexOf("system") == -1) {
          var stats = db[cName].stats();
          var found = false;
          for(qIdx in queries) {
            if(queries[qIdx].index == iName) {
              found = true;
              break;
            }
          }
          if(!found) {
            print("----- this index is not being used: ");
          } else {
            print("+++++ this index was used "+queries[qIdx].count+" times");
          }
          printjson(iName);
        }
      }
    }
  }
}

