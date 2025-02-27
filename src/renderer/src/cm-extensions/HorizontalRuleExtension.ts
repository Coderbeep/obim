import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

function createHorizontalLineDecorations(view) {
    const builder = new RangeSetBuilder();
    const { from, to } = view.state.selection.main;
    let lastYAMLMark = 0;

    syntaxTree(view.state).iterate({
        enter: (node) => {
            if (node.name === 'FrontmatterMark') {
                lastYAMLMark = node.from;
            }
            if (node.name === 'HorizontalRule' && lastYAMLMark !== node.from) {
                const isActive = from >= node.from && to <= node.to;

                if (!isActive) {
                    builder.add(node.from, node.to, Decoration.widget({
                        widget: new HorizontalRuleWidget(),
                        block: false
                    }));
                }
            }
        }
    });

    return builder.finish();
}

class HorizontalRuleWidget extends WidgetType {
    constructor() {
        super();
    }

    toDOM(view) {
        const container = document.createElement('div');
        container.className = 'cm-horizontal-rule-widget-container';

        const hr = document.createElement('hr');
        hr.className = 'cm-horizontal-rule-widget';

        container.appendChild(hr);

        return container;
    }
}

export const HorizontalRuleExtension = ViewPlugin.fromClass(class {
    decorations;

    constructor(view) {
        this.decorations = createHorizontalLineDecorations(view);
    }

    update(update) {
        if (update.docChanged || update.selectionSet) {
            this.decorations = createHorizontalLineDecorations(update.view);
        }
    }

    get decorationss() {
        return this.decorations;
    }
}, {
    decorations: v => v.decorations
});