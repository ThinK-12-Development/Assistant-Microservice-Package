"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitError = exports.ValidationError = exports.NotFoundError = exports.ForbiddenError = exports.AuthError = exports.GatewayError = exports.GatewayClient = void 0;
var client_js_1 = require("./client.js");
Object.defineProperty(exports, "GatewayClient", { enumerable: true, get: function () { return client_js_1.GatewayClient; } });
var errors_js_1 = require("./errors.js");
Object.defineProperty(exports, "GatewayError", { enumerable: true, get: function () { return errors_js_1.GatewayError; } });
Object.defineProperty(exports, "AuthError", { enumerable: true, get: function () { return errors_js_1.AuthError; } });
Object.defineProperty(exports, "ForbiddenError", { enumerable: true, get: function () { return errors_js_1.ForbiddenError; } });
Object.defineProperty(exports, "NotFoundError", { enumerable: true, get: function () { return errors_js_1.NotFoundError; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return errors_js_1.ValidationError; } });
Object.defineProperty(exports, "RateLimitError", { enumerable: true, get: function () { return errors_js_1.RateLimitError; } });
//# sourceMappingURL=index.js.map