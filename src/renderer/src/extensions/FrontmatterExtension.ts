import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { styleTags, Tag } from '@lezer/highlight';
import { Element, MarkdownExtension } from '@lezer/markdown';
import { RangeSetBuilder, StateEffect, StateField } from '@uiw/react-codemirror';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { IoSettingsOutline } from "react-icons/io5";
import { parseYAML } from '../hooks/YAMLutils';
import { syntaxTree } from '@codemirror/language';

/*
Parsing YAML frontmatter in markdown files.
- The frontmatter is parsed only at the beginning of the file
- It has priority over HorizontalRule elements
- The frontmatter is enclosed by a fence of three dashes (---)
*/

const frontMatterFence = /^---\s*$/;

const frontmatterTags = {
	Frontmatter: Tag.define(),
	FrontmatterMark: Tag.define(),
}

export const frontmatter: MarkdownExtension = {
	defineNodes: [{ name: 'Frontmatter', block: true }, 'FrontmatterMark'],
	props: [
		styleTags({
			Frontmatter: frontmatterTags.Frontmatter,
			FrontmatterMark: frontmatterTags.FrontmatterMark,
		}),
	],
	parseBlock: [
		{
			name: 'Frontmatter',
			before: 'HorizontalRule',
			parse: (cx, line) => {
				let end: number;
				const children = new Array<Element>();
				if (cx.lineStart === 0 && frontMatterFence.test(line.text)) {
					// 4 is the length of the frontmatter fence (---\n).
					children.push(cx.elt('FrontmatterMark', 0, 4));
					while (cx.nextLine()) {
						if (frontMatterFence.test(line.text)) {
							end = cx.lineStart + 4;
							children.push(cx.elt('FrontmatterMark', end - 4, end));
							cx.addElement(cx.elt('Frontmatter', 0, end, children));
							return true;
						}
					}
				}
				return false;
			},
		}
	]
};



/*
Frontmatter visibility logic.
- Creates a widget that displays the properties
	contained within the frontmatter.
- It is a block widget that replaces the frontmatter 
  whenever it is not selected.
*/

const toggleFrontmatterEffect = StateEffect.define();

const frontmatterVisibilityField = StateField.define({
	create() {
		return Decoration.none;
	},
	update(decorations, transaction) {
		for (let effect of transaction.effects) {
			if (effect.is(toggleFrontmatterEffect)) {
				decorations = effect.value;
			}
		}
		return decorations;
	},
	provide: field => EditorView.decorations.from(field)
})

function createFrontmatterDecorations(view) {
	const builder = new RangeSetBuilder();
	const { from, to } = view.state.selection.main;

	syntaxTree(view.state).iterate({
		enter: (node) => {
			if (node.name === 'Frontmatter') {
				const isActive = from >= node.from && to <= node.to;
				if (!isActive) {
					builder.add(
						node.from,
						node.to,
						Decoration.widget({
							widget: new PropertiesWidget(node.from, node.to),
							block: true,
							side: 1
						})
					)
				}
			}
		}
	})

	return builder.finish();
}

function toggleFrontmatterVisibility(view) {
	view.dispatch({
		effects: toggleFrontmatterEffect.of(createFrontmatterDecorations(view)),
	});
}

let cachedHeight = -1;

class PropertiesWidget extends WidgetType {
	constructor(private readonly start, private readonly end) {
		super();
	}

	toDOM(view) {
		console.log("Rendering Frontmatter Widget");
		const container = document.createElement('div');
		container.className = 'cm-properties-widget';

		const anotherDiv = document.createElement('div');
		anotherDiv.className = 'cm-property-container';

		const parsedYAML = parseYAML(view.state.sliceDoc(this.start + 4, this.end - 5));
		for (const key in parsedYAML) {
			const div = document.createElement('div');
			div.className = 'cm-property';

			const keyContainer = document.createElement('div');
			keyContainer.className = 'cm-key-container';

			const keyName = document.createElement('div');
			keyName.className = 'cm-key-name';
			keyName.textContent = `${key}`;


			const valuesContainer = document.createElement('div');
			valuesContainer.className = 'cm-value-container';
			const value = parsedYAML[key]

			const iconElement = React.createElement(IoSettingsOutline, { size: 18 });
			const icon = ReactDOMServer.renderToString(iconElement);

			const iconContainer = document.createElement('div');
			iconContainer.innerHTML = icon;
			iconContainer.className = 'cm-icon-container';
			keyContainer.appendChild(iconContainer);
			keyContainer.appendChild(keyName);

			if (Array.isArray(value)) {
				value.forEach(elem => {
					const span = document.createElement('span');
					span.textContent = elem;
					span.className = 'cm-value-item';
					valuesContainer.appendChild(span);
				});
			} else {
				const span = document.createElement('span');
				span.textContent = value;
				span.className = 'cm-value-item';
				valuesContainer.appendChild(span);
			}

			div.appendChild(keyContainer);
			div.appendChild(valuesContainer);
			anotherDiv.appendChild(div);
		}

		container.appendChild(anotherDiv);

		container.onclick = () => {
			view.dispatch({
				selection: { anchor: this.end - 1 }
			})
		}

		if (container.offsetHeight === 0) {
			const observer = new MutationObserver(() => {
				cachedHeight = container.offsetHeight;

				if (cachedHeight > 0) {
					observer.disconnect();
					view.requestMeasure();
				}
			})

			observer.observe(container, {
				childList: true,
				subtree: true,
				attributes: true
			});
		}

		return container;
	}

	eq(other: PropertiesWidget): boolean {
		return other.start === this.start && other.end === this.end;
	}

	get estimatedHeight() {
		return cachedHeight;
	}
}


export const FrontmatterExtension = [
	frontmatterVisibilityField,
	EditorView.updateListener.of(update => {
		if (update.docChanged || update.selectionSet) {
			toggleFrontmatterVisibility(update.view);
		}
	}),
];