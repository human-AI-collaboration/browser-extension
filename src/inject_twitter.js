// Same lookup as twitter_content.js: prefer the reply popup's composer over the inline one.
function findInComposer(selector) {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog?.querySelector(selector) || document.querySelector(selector);
}

function setDraftJsContent(content) {
    const editorElement = findInComposer('.DraftEditor-root');
    if (!editorElement) throw new Error("Draft.js editor not found.");
    const reactKey = Object.keys(editorElement).find(key =>
        key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
    );
    if (!reactKey) throw new Error("React internal instance key not found.");

    const fiberNode = editorElement[reactKey];
    const stateNode = fiberNode.return.stateNode;

    const ContentState = stateNode.props.editorState.getCurrentContent().constructor;
    const EditorState = stateNode.props.editorState.constructor;
    const SelectionState = stateNode.props.editorState.getSelection().constructor;

    // Create new content state
    const newContentState = ContentState.createFromText(content);

    // Create a new editor state with the new content state
    let newEditorState = EditorState.push(
        stateNode.props.editorState,
        newContentState,
        "insert-characters"
    );

    // Create a new selection state pointing to the end of the content
    const contentLength = newContentState.getPlainText().length;
    const newSelectionState = SelectionState.createEmpty(newContentState.getLastBlock().getKey()).merge({
        anchorOffset: contentLength,
        focusOffset: contentLength,
        hasFocus: true
    });

    // Apply the new selection state to the editor state
    newEditorState = EditorState.forceSelection(newEditorState, newSelectionState);

    setTimeout(() => {
        stateNode.props.onChange(newEditorState);
    }, 1);
}

// Fallback for editors other than Draft.js: replace the text the way a user
// would, so the editor's own input handling picks it up.
function setContentEditableContent(content) {
    const box = findInComposer('[data-testid="tweetTextarea_0"]');
    if (!box) throw new Error("Reply textbox not found.");
    box.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, content);
}

document.head.addEventListener("draft-js-twitter-content-update", event => {
    const { content } = event.detail;
    try {
        setDraftJsContent(content);
    } catch (error) {
        console.warn("Draft.js update failed, falling back to insertText:", error);
        try {
            setContentEditableContent(content);
        } catch (fallbackError) {
            console.error("Failed to update Twitter editor:", fallbackError);
        }
    }
});
