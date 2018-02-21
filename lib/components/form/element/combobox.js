/* globals _, React, ReactDOM, Str, UI */

/**
 * A combobox useful for searching for values in a large list
 */
module.exports = window.CreateClass({
    propTypes: {
        // These are the elements to show in the dropdown
        options: window.PropTypes.arrayOf(
            window.PropTypes.shape({
                // The value of the option, should be unique
                value: window.PropTypes.oneOfType([
                    window.PropTypes.string,
                    window.PropTypes.number
                ]),
                // The human readable text of the option
                text: window.PropTypes.string,
                // If we need more than text to style more
                children: window.PropTypes.element,
                // Whether or not this tag has an error (like out of policy)
                hasError: window.PropTypes.bool,
                // If this option is disabled, then it can't be selected and needs styled differently
                disabled: window.PropTypes.bool,
                // An id to use when checking if the options changed. It's used to avoid triggering changes when passing
                // children to it, if the id didn't change we assume no other properties changed either.
                id: window.PropTypes.any
            })
        ),

        // A default value to have selected
        defaultValue: window.PropTypes.oneOfType([
            window.PropTypes.string,
            window.PropTypes.number
        ]),

        // A default value to have selected - Use this one rather than defaultValue when the parent view might change the value passed.
        value: window.PropTypes.oneOfType([
            window.PropTypes.string,
            window.PropTypes.number
        ]),

        // A list of options to show as selected too. This is used when we are using this component to implement a multi
        // select, where another component holds all the selected options and this component only has to show the ones
        // that are already selected with the check mark.
        alreadySelectedOptions: window.PropTypes.arrayOf(
            window.PropTypes.shape({
                value: window.PropTypes.oneOfType([
                    window.PropTypes.string,
                    window.PropTypes.number
                ]),
                text: window.PropTypes.string,
            })
        ),

        // A callback that is fired when the value of the selector has changed
        onChange: window.PropTypes.func,

        // A callback that is fired when the value is cleared out by deleting text in the input
        onClear: window.PropTypes.func,

        // Callback fired when the dropdown is open/closed. It will pass a boolean param with true if it's open
        onDropdownStateChange: window.PropTypes.func,

        // By default we show the selected option's value
        // You can overwrite it to display a different property (like 'text')
        propertyToDisplay: window.PropTypes.oneOf(['text', 'value']),

        // Whether or not the combobox should be open when we initialize it
        openOnInit: window.PropTypes.bool,

        // A property to allow the combobox set to any manual entry the user chooses
        allowAnyValue: window.PropTypes.bool,

        // What text should we show when the text entered doesn't match any of the results. It's an underscore template
        // that will be passed `value` as the current entered text.
        noResultsText: window.PropTypes.string,

        // A property to determine if the selector is user editable
        isReadOnly: window.PropTypes.bool,

        // Text to use for the placeholder, defaults to "Type to search..."
        placeholder: window.PropTypes.string,

        // An array of extra classes to put on the combobox
        extraClasses: window.PropTypes.arrayOf(window.PropTypes.string),

        // This makes this component hidden till someone manually calls openDropdown
        hideUntilManuallyOpened: window.PropTypes.bool,

        // Do we want to always show the selected options on top?
        alwaysShowSelectedOnTop: window.PropTypes.bool
    },

    getDefaultProps() {
        return {
            onChange: () => {},
            onClear: () => {},
            onDropdownStateChange: () => {},
            maxItemsToShow: 500,
            maxSearchResults: 200,
            propertyToDisplay: 'value',
            allowAnyValue: false,
            isReadOnly: false,
            alreadySelectedOptions: [],
            noResultsText: 'No results',
            hideUntilManuallyOpened: false,
            alwaysShowSelectedOnTop: false,
        };
    },

    /**
     * @param {Boolean} noDefaultValue Overrides the default value to have '' as the currentValue
     * @param {Object[]} [newOptions] when resetting this component, we can specify new options to use
     * @param {Object[]} [newAlreadySelectedOptions] when resetting this component, we can specify new already selected options to use
     *
     * @returns {Object}
     */
    getInitialState(noDefaultValue, newOptions, newAlreadySelectedOptions) {
        this.options = newOptions || this.props.options;

        const value = _.isUndefined(this.props.value) ? this.props.defaultValue || '' : this.props.value;
        const currentValue = this.initialValue || value;

        let defaultSelectedOption = _(this.options).find(o => o.value === currentValue && !o.isFake);

        // If no default was found and initialText was present then we can use initialText values
        if (!defaultSelectedOption && this.initialText) {
            defaultSelectedOption = {};
            defaultSelectedOption.text = this.initialText;
        }

        return {
            isDropdownOpen: this.props.openOnInit,
            currentValue: noDefaultValue ? this.initialValue || '' : value,
            currentText: defaultSelectedOption ? defaultSelectedOption.text : '',
            options: this.getTruncatedOptions(currentValue, newAlreadySelectedOptions),
            focusedIndex: 0,
            selectedIndex: null,
            isDisabled: this.props.isReadOnly
        };
    },

    componentWillReceiveProps(nextProps) {
        if (!_.isUndefined(nextProps.value) && !_.isEqual(nextProps.value, this.state.currentValue)) {
            this.setValue(nextProps.value);
        }

        if (!_.isUndefined(nextProps.options)) {
            // If the options have an id property, we use that to compare them and determine if they changed, if not
            // we'll use the whole options array.
            if (_.has(nextProps.options, '0.id')) {
                if (!_.isEqual(_.pluck(nextProps.options, 'id'), _.pluck(this.props.options, 'id')) || !_.isEqual(_.pluck(nextProps.alreadySelectedOptions, 'id'), _.pluck(this.props.alreadySelectedOptions, 'id'))) {
                    this.reset(false, nextProps.options, nextProps.alreadySelectedOptions);
                }
            } else if (!_.isEqual(nextProps.options, this.props.options) || !_.isEqual(nextProps.alreadySelectedOptions, this.props.alreadySelectedOptions)) {
                this.reset(false, nextProps.options, nextProps.alreadySelectedOptions);
            }
        }
    },

    componentDidMount() {
        if (this.props.openOnInit) {
            // Our dropdown will be open, so we need to listen for our click away events
            // and put focus on the input
            _.defer(this.resetClickAwayHandler);
            $(this.refs.input).focus().select();
        }
    },

    componentWillUnmount() {
        // Don't ever let this handler linger after unmounting
        $('body').off('click.clickaway', this.handleClickAway);
    },

    /**
     * Returns a set of our full options according to the maxItemsToShow
     *
     * @param {String|Number} currentValue
     * @param {Object[]} [newAlreadySelectedOptions]
     * @returns {Array}
     */
    getTruncatedOptions(currentValue, newAlreadySelectedOptions) {
        const alreadySelected = newAlreadySelectedOptions || this.props.alreadySelectedOptions;

        // Convert an array of strings into an array of objects for our dropdown
        const truncatedOptions = _.chain(this.options).map(option => ({
            text: option.text,
            children: option.children,
            value: option.value,
            disabled: option.disabled,
            focused: false,
            isSelected: _.isEqual(option.value, currentValue) || Boolean(_.findWhere(alreadySelected, {value: option.value}))
        }))
            .sortBy((o) => {
                // Fake entries go to the bottom and selected entries go to the top only if alwaysShowSelectedOnTop was passed
                if (o.showLast) {
                    return 2;
                }
                return o.isSelected && this.props.alwaysShowSelectedOnTop ? 0 : 1;
            })
            .first(this.props.maxItemsToShow)
            .value();

        if (!truncatedOptions.length) {
            truncatedOptions.push({
                text: 'No items',
                value: '',
                isSelectable: false,
                isFake: true,
                showLast: true,
            });
        } else if (this.options.length > this.props.maxItemsToShow) {
            truncatedOptions.push({
                text: `Viewing first ${this.props.maxItemsToShow} items. Search to see more.`,
                value: '',
                isSelectable: false,
                isFake: true,
                showLast: true,
            });
        }

        return truncatedOptions;
    },

    /**
     * Returns the selected value(s)
     *
     * @return {String}
     */
    getValue() {
        return this.state.currentValue;
    },

    /**
     * Sets the current value
     *
     * @param {String} val
     */
    setValue(val) {
        let currentText = '';
        // Deselect all other options but the one matching our value
        const newOptions = _(this.state.options).map((o) => {
            const option = o;
            const isSelected = _.isEqual(option.value, val);
            option.isSelected = isSelected || Boolean(_.findWhere(this.props.alreadySelectedOptions, {value: option.value}));
            if (isSelected && !option.isFake) {
                currentText = option.text;
            }
            return option;
        });
        this.initialValue = val;
        this.setState({
            currentValue: val,
            currentText,
            options: newOptions
        });
        if (this.state.isDropdownOpen) {
            $(this.refs.input).focus().select();
        }
    },

    /**
     * Hard sets the current text to what we want
     *
     * @param {String} currentText
     */
    setText(currentText) {
        this.initialValue = currentText;
        this.initialText = currentText;
        this.setState({currentText});
    },

    /**
     * Sets the disabled state of this component
     *
     * @param {Boolean} isDisabled
     */
    setDisabled(isDisabled) {
        this.setState({isDisabled});
    },

    /**
     * Set an error for a specific tag
     */
    setError() {
        this.setState({
            hasError: true
        });
    },

    /**
     * Deselects any current option if it exists
     */
    deselectCurrentOption() {
        if (this.state.selectedIndex !== null
            && this.state.options[this.state.selectedIndex]) {
            this.state.options[this.state.selectedIndex].isSelected = false;
        }
    },

    /**
     * Swaps the focused index from {oldFocusedIndex} to {newFocusedIndex}
     *
     * @param {number} oldFocusedIndex
     * @param {number} newFocusedIndex
     */
    switchFocusedIndex(oldFocusedIndex, newFocusedIndex) {
        this.state.options[oldFocusedIndex].focused = false;
        this.state.options[newFocusedIndex].focused = true;
    },

    /**
     * Returns the selector to it's original state
     *
     * @param {Boolean} noDefaultValue Overrides the initials state defaultValue by setting the currentValue to ''
     * @param {Object[]} [newOptions] we can recreate it with new options
     * @param {Object[]} [newAlreadySelectedOptions] we can recreate it with new already selected options
     */
    reset(noDefaultValue, newOptions, newAlreadySelectedOptions) {
        if (newOptions) {
            this.options = newOptions;
        }
        const state = this.getInitialState(noDefaultValue, this.options, newAlreadySelectedOptions);
        this.setState(state, () => this.props.onDropdownStateChange(Boolean(state.isDropdownOpen)));
    },

    /**
     * When the dropdown is closed, we reset the focused property of all of our options
     */
    resetFocusedElements() {
        this.setState({
            options: _(this.state.options).map((o) => {
                const option = o;
                option.focused = false;
                return option;
            })
        });
    },

    /**
     * Fired when we "click away" with the dropdown open
     *
     * @param {SyntheticEvent} e
     */
    handleClickAway(e) {
        // Ignore the click away event if something within our combobox was clicked
        if ($(e.target).parents('.expensify-input-group').length
            && $(e.target).parents('.expensify-input-group')[0] === ReactDOM.findDOMNode(this)) {
            return;
        }
        this.reset(true);

        // Trigger a change so that inline editor knows to cancel itself
        this.props.onChange(this.initialValue || this.props.value || this.props.defaultValue);
    },

    /**
     * Sets a clicklistener to close the dropdown if it is currently open
     */
    resetClickAwayHandler() {
        $('body').off('click.clickaway', this.handleClickAway);
        if (this.state.isDropdownOpen) {
            $('body').on('click.clickaway', this.handleClickAway);
        } else {
            this.resetFocusedElements();
        }
    },

    /**
     * Clear an error for a specific tag
     */
    clearError() {
        this.setState({
            hasError: false
        });
    },

    /**
     * Opens or closes the dropdown
     */
    toggleDropdown() {
        if (this.state.isDropdownOpen) {
            this.closeDropdown();

            // Trigger a change so that inline editor knows to cancel itself
            this.props.onChange(this.state.currentValue);
        } else {
            this.openDropdown();
        }
    },

    /**
     * Just open the dropdown (when the input gets focus)
     */
    openDropdown() {
        if (this.state.isDropdownOpen) {
            return;
        }
        this.setState({
            isDropdownOpen: true
        }, () => {
            this.props.onDropdownStateChange(true);
            this.resetClickAwayHandler();
            $(this.refs.input).focus().select();
        });
    },

    /**
     * Closes the dropdown and removes the click handler that calls this function after the dropdown is closed
     *
     * @param {SyntheticEvent} [e]
     */
    closeDropdown(e) {
        if (!this.state.isDropdownOpen) {
            return;
        }
        // If the dropdown is being closed from clicking on our input, then we actually don't close the dropdown. This
        // occurs because when first opening the dropdown when the input receives focus, it fires off the clickaway
        // event and I couldn't stop it. So this is the work around.
        if (e && ($(e.target)[0] === $(this.refs.input)[0] || $(e.target).parent().hasClass(UI.DISABLED))) {
            return;
        }
        this.setState({
            isDropdownOpen: false
        }, () => {
            this.props.onDropdownStateChange(false);
            this.resetClickAwayHandler();
        });
    },

    /**
     * If the user presses tab when the dropdown button is focused, then we close the dropdown
     * because they are trying to get to the next form components
     *
     * @param {SyntheticEvent} e
     */
    closeDropdownOnTabOut(e) {
        if (e.which === 9) {
            this.closeDropdown();
        }
    },

    /**
     * Stops events from doing anything outside of the current function (in theory).
     * This doesn't work between jquery and React events because React's event propagation is a separate system.
     *
     * @param {SyntheticEvent} e
     */
    stopEvent(e) {
        e.preventDefault();
        if (e.nativeEvent) {
            e.nativeEvent.stopImmediatePropagation();
        } else {
            e.stopImmediatePropagation();
        }
        e.stopPropagation();
    },

    /**
     * This is triggered whenever there is a key up event in the text input
     *
     * @param {SyntheticEvent} e
     */
    handleKeyDown(e) {
        let oldFocusedIndex;
        let newFocusedIndex;
        let currentValue;
        let currentText;

        // Handle the arrow keys
        switch (e.which) {
        // Down - move focused selection down
        case 40:
            oldFocusedIndex = this.state.focusedIndex;
            newFocusedIndex = oldFocusedIndex + 1;

            // Wrap around to the top of the list
            if (newFocusedIndex > this.state.options.length - 1) {
                newFocusedIndex = 0;
            }

            this.switchFocusedIndex(oldFocusedIndex, newFocusedIndex);
            this.setState({
                focusedIndex: newFocusedIndex,
                options: this.state.options,
                isDropdownOpen: true
            }, this.resetClickAwayHandler);
            this.stopEvent(e);
            break;

        // Up - move focused selection up
        case 38:
            oldFocusedIndex = this.state.focusedIndex;
            newFocusedIndex = oldFocusedIndex - 1;

            // Wrap around to the bottom of the list
            if (newFocusedIndex < 0) {
                newFocusedIndex = this.state.options.length - 1;
            }

            this.switchFocusedIndex(oldFocusedIndex, newFocusedIndex);
            this.setState({
                focusedIndex: newFocusedIndex,
                options: this.state.options,
                isDropdownOpen: true
            }, this.resetClickAwayHandler);
            this.stopEvent(e);
            break;

        // Enter - set selection
        case 13: {
            if (!this.state.isDropdownOpen) {
                return;
            }

            // Don't select disabled things
            if (this.state.options[this.state.focusedIndex].disabled) {
                break;
            }
            this.deselectCurrentOption();

            currentValue = this.state.options[this.state.focusedIndex].value;
            currentText = this.state.options[this.state.focusedIndex].text;

            // if allowAnyValue is true and currentValue is absent then set it manually to what the user has entered
            if (!currentValue && this.props.allowAnyValue) {
                currentValue = e.target.value;
                currentText = currentValue;
            }

            this.setState({
                options: this.getTruncatedOptions(currentValue),
                selectedIndex: this.state.focusedIndex,
                currentValue,
                currentText,
                isDropdownOpen: false
            }, this.resetClickAwayHandler);

            // Fire our onChange callback
            this.props.onChange(currentValue);
            this.initialValue = currentValue;

            this.stopEvent(e);
            break;
        }

        // Tab & Escape - clear selection
        case 9:
        case 27:
            this.reset(true);

            // Fire our onChange callback
            this.props.onChange(this.initialValue || this.props.value || this.props.defaultValue);

            // Stop the event from propagating if the escape key is pressed
            if (e.which === 27) {
                this.stopEvent(e);
            }
            break;

        default:
            break;
        }
    },

    /**
     * This is triggered whenever there is a change event in the text input
     * (from any valid input that's not being handled from the keyUp event)
     *
     * @param {SyntheticEvent} e
     */
    performSearch(e) {
        let shouldShowDropdown = this.state.isDropdownOpen;

        // If we don't have an empty value, show the dropdown.
        // If empty value, hide the dropdown, update the initial fields and show the original options.
        if (e.target.value.trim() !== '' && !shouldShowDropdown) {
            shouldShowDropdown = true;
        } else if (e.target.value === '') {
            this.initialValue = '';
            this.initialText = '';

            // This will show all the original items while the input field stays empty. Also the dropdown will remain open.
            this.setState({
                currentValue: '',
                currentText: '',
                isDropdownOpen: true,
                options: this.getTruncatedOptions('')
            }, this.resetClickAwayHandler);

            // Trigger the callback to clear out the value
            this.props.onClear();
            return;
        }

        // Search our original options. We want:
        // Exact matches first
        // beginning-of-string matches second
        // middle-of-string matches last
        const matchRegexes = [
            new RegExp(`^${Str.escapeForRegExp(e.target.value)}$`, 'i'),
            new RegExp(`^${Str.escapeForRegExp(e.target.value)}`, 'i'),
            new RegExp(Str.escapeForRegExp(e.target.value), 'i'),
        ];
        let hasMoreResults = false;
        let matches = new Set();

        for (let i = 0; i < matchRegexes.length; i++) {
            if (matches.size < this.props.maxSearchResults) {
                for (let j = 0; j < this.options.length; j++) {
                    // Don't include the disabled options
                    if (!this.options[j].disabled && matchRegexes[i].test(this.options[j].text.toString().replace(new RegExp(/&nbsp;/g), ''))) {
                        matches.add(this.options[j]);
                    }

                    if (matches.size === this.props.maxSearchResults) {
                        hasMoreResults = true;
                        break;
                    }
                }
            } else {
                hasMoreResults = true;
                break;
            }
        }
        matches = Array.from(matches);

        const options = _(matches).map(option => ({
            text: option.text,
            value: option.value,
            disabled: option.disabled,
            children: option.children,
            focused: false,
            isSelected: _.isEqual(option.value, e.target.value) || Boolean(_.findWhere(this.props.alreadySelectedOptions, {value: option.value}))
        }));

        // Focus the first option if there is one and show a message dependent on what options are present
        if (options.length) {
            options[0].focused = true;

            if (hasMoreResults) {
                options.push({
                    text: `Viewing first ${options.length} results`,
                    value: '',
                    isSelectable: false,
                    isFake: true,
                    showLast: true,
                });
            }
        } else {
            options.push({
                text: _.template(this.props.noResultsText)({value: e.target.value}),
                value: '',
                isSelectable: this.props.allowAnyValue,
                isFake: true,
                showLast: true,
            });
        }

        this.setState({
            currentValue: e.target.value,
            currentText: e.target.value,
            isDropdownOpen: shouldShowDropdown,
            focusedIndex: 0,
            options
        }, this.resetClickAwayHandler);
    },

    /**
     * Handle state changes for when a user clicks on an item in the dropdown
     *
     * @param  {String|Number} selectedValue
     */
    handleClick(selectedValue) {
        this.deselectCurrentOption();

        // Select the new item, set our new indexes, close the dropdown
        // Unselect all other options
        const newSelectedIndex = _(this.options).findIndex({value: selectedValue});
        const currentlySelectedOption = _(this.options).findWhere({value: selectedValue});

        this.setState({
            options: this.getTruncatedOptions(selectedValue),
            selectedIndex: newSelectedIndex,
            focusedIndex: newSelectedIndex,
            currentValue: selectedValue,
            currentText: _.get(currentlySelectedOption, 'text', ''),
            isDropdownOpen: false
        }, this.resetClickAwayHandler);

        // Fire our onChange callback
        this.props.onChange(selectedValue);
    },

    render() {
        if (this.props.hideUntilManuallyOpened && !this.state.isDropdownOpen) {
            return null;
        }
        const inputGroupClasses = {
            'input-group': true,
            'expensify-input-group': true,
            open: this.state.isDropdownOpen
        };
        const inputGroupBtnClasses = {
            'input-group-btn': true,
            open: this.state.isDropdownOpen
        };

        return (
            <div
                className={React.classNames(inputGroupClasses, this.props.extraClasses)}
                onKeyDown={this.handleKeyDown}
            >
                <input
                    ref="input"
                    type="text"
                    className={React.classNames(['form-control', {error: this.state.hasError}])}
                    disabled={this.state.isDisabled}
                    aria-label="..."
                    onChange={this.performSearch}
                    onKeyDown={this.closeDropdownOnTabOut}
                    value={this.props.propertyToDisplay === 'value'
                        ? _.unescape(this.state.currentValue)
                        : _.unescape(this.state.currentText.replace(new RegExp(/&nbsp;/g), ''))}
                    onFocus={this.openDropdown}
                    autoComplete="off"
                    placeholder={this.props.placeholder || 'Type to search...'}
                    tabIndex="0"
                />
                <div className={React.classNames(inputGroupBtnClasses)}>
                    <button
                        type="button"
                        className={React.classNames(['btn', 'btn-default', 'dropdown-toggle', {error: this.state.hasError}])}
                        disabled={this.state.isDisabled}
                        onClick={this.toggleDropdown}
                        onKeyDown={this.closeDropdownOnTabOut}
                        tabIndex="-1"
                    >
                        <span className="caret" />
                        <span className="sr-only">Toggle Dropdown</span>
                    </button>
                    {this.state.isDropdownOpen && <React.c.Dropdown
                        options={this.state.options}
                        extraClasses={['expensify-dropdown']}
                        onChange={this.handleClick}
                    />}
                </div>
            </div>
        );
    }
});