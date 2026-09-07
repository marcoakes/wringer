import ts from "typescript";
import type { PlanDeclaration } from "./types";
/** Editor/type-checking helper. Repository DSL files are parsed, never imported. */
export const definePlan = (declaration: PlanDeclaration): PlanDeclaration => declaration;
export function parsePlanTypeScript(source: string, filename = "wringer.plan.ts"): unknown {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const diagnostics = (file as ts.SourceFile & {
        parseDiagnostics: ts.Diagnostic[];
    }).parseDiagnostics;
    if (diagnostics.length)
        throw new Error(`Invalid plan TypeScript: ${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, " ")}`);
    let imported = false, declaration: unknown, exports = 0;
    for (const statement of file.statements) {
        if (ts.isImportDeclaration(statement)) {
            if (imported || statement.attributes || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@wringer/plan")
                throw new Error("Plan DSL permits only import { definePlan } from '@wringer/plan'; no import is executed");
            const clause = statement.importClause;
            if (!clause || clause.isTypeOnly || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.namedBindings.elements.length !== 1)
                throw new Error("Plan DSL import must name only definePlan");
            const item = clause.namedBindings.elements[0]!;
            if (item.name.text !== "definePlan" || item.propertyName || item.isTypeOnly)
                throw new Error("Plan DSL cannot alias imports");
            imported = true;
        }
        else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
            const expression = statement.expression;
            if (++exports !== 1 || !ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression) || expression.expression.text !== "definePlan" || expression.arguments.length !== 1 || expression.typeArguments)
                throw new Error("Plan DSL requires exactly export default definePlan({...literal data...})");
            declaration = literal(expression.arguments[0]!);
        }
        else {
            throw new Error("Executable TypeScript is forbidden in a plan: only one import and a literal definePlan declaration are supported");
        }
    }
    if (!imported || exports !== 1)
        throw new Error("Plan DSL needs its definePlan import and default declaration");
    return declaration;
}
function literal(node: ts.Expression, depth = 0): unknown {
    if (depth > 40)
        throw new Error("Plan DSL nesting exceeds 40 levels");
    if (ts.isParenthesizedExpression(node))
        return literal(node.expression, depth + 1);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        return node.text;
    if (ts.isNumericLiteral(node))
        return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword)
        return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword)
        return false;
    if (node.kind === ts.SyntaxKind.NullKeyword)
        return null;
    if (ts.isArrayLiteralExpression(node))
        return node.elements.map(element => literal(element, depth + 1));
    if (ts.isObjectLiteralExpression(node)) {
        const result: Record<string, unknown> = Object.create(null);
        for (const property of node.properties) {
            if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name))
                throw new Error("Plan DSL forbids spreads, computed keys, methods, getters and shorthand expressions");
            const name = property.name;
            if (!ts.isIdentifier(name) && !ts.isStringLiteral(name))
                throw new Error("Plan DSL mapping keys must be plain names or strings");
            const key = name.text;
            if (["__proto__", "prototype", "constructor"].includes(key) || Object.hasOwn(result, key))
                throw new Error(`Unsafe or duplicate plan key: ${key}`);
            result[key] = literal(property.initializer, depth + 1);
        }
        return result;
    }
    throw new Error(`Plan DSL expressions are data only; ${ts.SyntaxKind[node.kind]} is not allowed`);
}
