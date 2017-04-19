"use strict";

/**
 * Module dependencies.
 */
var mongoose = require('mongoose'),
    timestamps = require('mongoose-timestamp'),
    _ = require('lodash'),
    async = require('async'),
    tree = require('mongoose-path-tree'),
    streamWorker = require('mongoose-path-tree/node_modules/stream-worker'),
    Schema = mongoose.Schema,
    ObjectId = mongoose.Schema.Types.ObjectId;

var CategorySchema = new Schema({
    //name: { type: String }, //Meta Title
    fullName: { type: String, default: 'All' },
    //parent: { type: ObjectId, ref: 'productCategory', default: null },
    // child: [{ type: ObjectId, default: null }],
    users: [{ type: ObjectId, ref: 'Users', default: null }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'Users' },
    editedBy: { type: Schema.Types.ObjectId, ref: 'Users' },

    //entity: [String],
    idx: { type: Number, default: 0 }, //order in array for nodes

    langs: [{
        _id: false,
        lang: { type: String, default: 'fr' },
        name: { type: String, default: 'All', unique: true },
    }],

    nestingLevel: { type: Number, default: 0 },
    sequence: { type: Number, default: 0 },
    main: { type: Boolean, default: false },
    removable: { type: Boolean, default: true },
    accountsCount: { type: Number, default: 0 }
}, { collection: 'accountsCategories' });

CategorySchema.plugin(tree, {
    pathSeparator: '#', // Default path separator
    onDelete: 'REPARENT', // Can be set to 'DELETE' or 'REPARENT'. Default: 'REPARENT'
    numWorkers: 5, // Number of stream workers
    idType: Schema.ObjectId // Type used for _id. Can be, for example, String generated by shortid module
});
CategorySchema.plugin(timestamps);

CategorySchema.statics.updateParentsCategory = function(newCategoryId, parentId, modifier, callback) {
    var ProductCategory = this;
    var id;
    var updateCriterior;
    var SocieteModel = MODEL('societe').Schema;

    if (modifier === 'remove')
        return SocieteModel.update({ 'companyInfo.category': newCategoryId }, { $set: { 'companyInfo.category': parentId } }, { upsert: false, multi: true }, function(err, doc) {
            if (err)
                return callback(err);

            return callback(null);
        });

    callback(null);



    /*ProductCategory.findOneAndUpdate({ _id: parentId }, updateCriterior, function(err, result) {
        if (err)
            return callback(err);

        if (!result || !result.parent)
            return callback(null);

        id = result.parent;
        this.updateParentsCategory(newCategoryId, id, modifier, callback);
    });*/
};

CategorySchema.statics.updateNestingLevel = function(id, nestingLevel, callback) {
    var Model = this;

    Model.find({ parent: id }).exec(function(err, result) {
        var n = 0;
        if (result.length !== 0)
            return result.forEach(function(item) {
                n++;

                Model.findByIdAndUpdate(item._id, { nestingLevel: nestingLevel + 1 }, { new: true }, function(err, res) {
                    if (result.length === n)
                        Model.updateNestingLevel(res._id, res.nestingLevel + 1, callback);
                    else
                        Model.updateNestingLevel(res._id, res.nestingLevel + 1);

                });
            });

        if (callback)
            callback();
    });
};


CategorySchema.statics.updateSequence = function(model, sequenceField, start, end, parentDepartmentStart, parentDepartmentEnd, isCreate, isDelete, callback) {
    var query;
    var objFind = {};
    var objChange = {};
    var inc = -1;
    var c;

    if (parentDepartmentStart === parentDepartmentEnd) { // on one workflow

        if (!(isCreate || isDelete)) {

            if (start > end) {
                inc = 1;
                c = end;
                end = start;
                start = c;
            } else
                end -= 1;

            objChange = {};
            objFind = { parent: parentDepartmentStart };
            objFind[sequenceField] = { $gte: start, $lte: end };
            objChange[sequenceField] = inc;
            query = model.update(objFind, { $inc: objChange }, { multi: true });
            query.exec(function(err, res) {
                if (callback)
                    callback((inc === -1) ? end : start);

            });
        } else {
            if (isCreate) {
                query = model.count({ parent: parentDepartmentStart }).exec(function(err, res) {
                    if (callback)
                        callback(res);

                });
            }
            if (isDelete) {
                objChange = {};
                objFind = { parent: parentDepartmentStart };
                objFind[sequenceField] = { $gt: start };
                objChange[sequenceField] = -1;
                query = model.update(objFind, { $inc: objChange }, { multi: true });
                query.exec(function(err, res) {
                    if (callback)
                        callback(res);

                });
            }
        }
    } else { // nbetween workflow
        objChange = {};
        objFind = { parent: parentDepartmentStart };
        objFind[sequenceField] = { $gte: start };
        objChange[sequenceField] = -1;
        query = model.update(objFind, { $inc: objChange }, { multi: true });
        query.exec();
        objFind = { parent: parentDepartmentEnd };
        objFind[sequenceField] = { $gte: end };
        objChange[sequenceField] = 1;
        query = model.update(objFind, { $inc: objChange }, { multi: true });
        query.exec(function() {
            if (callback)
                callback(end);

        });

    }
};

CategorySchema.statics.updateFullName = function(id, cb) {
    var Model = this;
    var fullName;
    var parrentFullName;
    var path;

    Model
        .findById(id)
        .populate('parent')
        .exec(function(err, category) {
            parrentFullName = category && category.parent ? category.parent.fullName : null;
            if (parrentFullName)
                fullName = parrentFullName + ' / ' + category.langs[0].name;
            else
                fullName = category.langs[0].name;

            path = (category && category.parent ? category.parent.path + "#" : "") + category._id.toString();

            if (!err)
                Model.findByIdAndUpdate(id, { $set: { fullName: fullName, path: path } }, { new: true }, cb);

        });
};

CategorySchema.statics.removeAllChild = function(id, callback) {
    var Model = this;
    var Societe = MODEL('societe').Schema;

    Model.find({
        $or: [
            { ancestors: { $elemMatch: { $eq: id } } },
            { _id: id }
        ]
    }, { _id: 1 }, function(err, result) {
        var ids;

        if (err)
            return callback(err);

        ids = _.pluck(result, '_id');

        function deleteCategories(parCb) {
            Model.remove({ _id: { $in: ids } }, function(err) {
                if (err)
                    return parCb(err);


                parCb(null);
            });
        }

        /*function deleteSocietes(parCb) {
            Societe.remove({ 'accounting.category._id': { $in: ids } }, function(err) {
                if (err)
                    return parCb(err);


                parCb(null);
            });
        }*/

        async
        .parallel([deleteCategories, deleteSocietes], function(err) {
            if (err)
                return callback(err);


            callback(null);
        });
    });
};

CategorySchema.virtual('value')
    .get(function() {
        return this.langs[0].value;
    });


CategorySchema.pre('save', function(next) {
    var self = this;

    //if (self.langs[0])
    //    self.name = self.langs[0].name;

    next();
});

exports.Schema = mongoose.model('accountsCategory', CategorySchema);
exports.name = "accountsCategory";