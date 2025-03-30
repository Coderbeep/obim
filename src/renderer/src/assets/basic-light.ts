import { Extension } from '@codemirror/state';
import {
	HighlightStyle,
	syntaxHighlighting,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const createCodeBlockTheme = ({ styles }): Extension => {
	const highlightStyle = HighlightStyle.define(styles);
	const extension = [syntaxHighlighting(highlightStyle)];
	return extension;
};

export const basicLight = createCodeBlockTheme({
	styles: [
		{
			tag: t.strong,
			fontWeight: 'bold',
		},
		{
			tag: t.heading,
			fontWeight: 'bold',
		},
		{
			tag: t.comment,
			color: '#8E908C',
		},
		{
			tag: [t.variableName, t.self, t.propertyName, t.attributeName, t.regexp],
			color: '#C82829',
		},
		{
			tag: [t.number, t.bool, t.null],
			color: '#F5871F',
		},
		{
			tag: [t.className, t.typeName, t.definition(t.typeName)],
			color: '#C99E00',
		},
		{
			tag: [t.string, t.special(t.brace)],
			color: '#718C00',
		},
		{
			tag: t.operator,
			color: '#3E999F',
		},
		{
			tag: [t.definition(t.propertyName), t.function(t.variableName)],
			color: '#4271AE',
		},
		{
			tag: t.keyword,
			color: '#8959A8',
		},
		{
			tag: t.derefOperator,
			color: '#4D4D4C',
		},
		{
			tag: [t.processingInstruction, t.inserted],
		},
	],
});