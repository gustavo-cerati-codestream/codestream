import React, { Component } from "react";
import { connect } from "react-redux";
import createClassString from "classnames";
import * as reviewSelectors from "../store/reviews/reducer";
import * as userSelectors from "../store/users/reducer";
import Tag from "./Tag";
import Menu from "./Menu";
import Icon from "./Icon";
import ScrollBox from "./ScrollBox";
import SearchResult from "./SearchResult";
import { ProTip } from "./ProTip";
import { HostApi } from "../webview-api";
import { includes as _includes, sortBy as _sortBy, debounce } from "lodash-es";
import { PanelHeader } from "../src/components/PanelHeader";
import styled from "styled-components";
import FiltersButton from "../src/components/FiltersButton";
import { OpenUrlRequestType, CodemarkPlus } from "@codestream/protocols/agent";
import { isCSReview, CSReview } from "../protocols/agent/api.protocol.models";
import { Disposable } from "vscode-languageserver-protocol";
import { CodeStreamState } from "../store";
import { ReposState } from "../store/repos/types";
import { AnyObject } from "../utils";
import { setUserPreference } from "./actions";
import { withSearchableItems, WithSearchableItemsProps } from "./SpatialView/withSearchableItems";
import { FilterQuery } from "../store/preferences/types";
import { getSavedSearchFilters } from "../store/preferences/reducer";
import { setQuery } from "../store/context/actions";

const SearchBar = styled.div`
	display: flex;
	flex-direction: row;
	button {
		z-index: 2;
	}
	.search-input {
		position: relative;
		flex-grow: 10;
		width: 100%;
		input.control {
			// make space for the search icon
			padding-left: 32px !important;
			// the bookmark icon is narrower so requires less space
			padding-right: 25px !important;
			height: 100%;
			border: 1px solid var(--base-border-color);
			border-left: none;
			margin-left: -1px;
		}
		.icon.search {
			position: absolute;
			left: 8px;
			top: 6px;
			opacity: 0.5;
		}
		.save {
			position: absolute;
			right: 6px;
			top: 6px;
			opacity: 0.5;
			&:hover {
				opacity: 1;
			}
		}
	}
`;

const SaveFilter = styled.div`
	position: relative;
	display: inline-block;
	margin: -1px 0 -1px 0;
	input.control {
		width: 8em;
		font-size: 12px !important;
		padding-left: 24px !important;
		&::placeholder {
			font-size: 12px !important;
		}
	}
	.icon.bookmark {
		position: absolute;
		left: 5px;
		top: 4px;
		opacity: 0.5;
	}
`;

const SavedFilter = styled.div`
	position: relative;
	display: inline-block;
	label {
		font-size: 12px !important;
		cursor: pointer;
		display: inline-block;
		padding: 3px 5px 3px 5px;
		&:hover {
			color: var(--text-color-highlight);
		}
	}
	.icon.bookmark {
		opacity: 0.75;
	}
	.icon.gear {
		display: inline-block;
		padding-left: 3px;
		visibility: hidden;
		opacity: 0.5;
		cursor: pointer;
		&:hover {
			opacity: 1;
		}
	}
	&:hover {
		.icon.gear {
			visibility: visible;
		}
	}
`;

const sameDay = (d1, d2) => {
	return (
		d1.getFullYear() === d2.getFullYear() &&
		d1.getMonth() === d2.getMonth() &&
		d1.getDate() === d2.getDate()
	);
};

interface DispatchProps {
	setUserPreference: (...args: Parameters<typeof setUserPreference>) => Promise<any>;
	setQuery: (...args: Parameters<typeof setQuery>) => ReturnType<typeof setQuery>;
}

interface ConnectedProps {
	noReviewsAtAll: boolean;
	webviewFocused: boolean;
	usernameMap: { [id: string]: string };
	currentUserId: string;
	currentUsername: string;
	savedSearchFilters: FilterQuery[];
	authorFilter: string;
	typeFilter: string;
	repos: ReposState;
	teamTagsArray: any[];
	query: string;
}

interface Props extends ConnectedProps, DispatchProps, WithSearchableItemsProps {}

interface State {
	isLoading: boolean;
	expanded: {
		waitingForMe: boolean;
		createdByMe: boolean;
		open: boolean;
		closed: boolean;
		recent: boolean;
	};
	filters: AnyObject;
	q: string;
	savingFilter?: any;
	editingFilterIndex?: number;
	editingFilterLabel?: string;
	filterMenuTarget?: any;
	filterMenuOpen?: number;
	displayItems: AnyObject;
	totalItems: number;
}

export class SimpleFilterSearchPanel extends Component<Props, State> {
	readonly disposables: Disposable[] = [];
	readonly sectionLabel = {
		waitingForMe: "Open & Assigned to Me",
		createdByMe: "Created By Me",
		open: "Open",
		closed: "Closed",
		recent: "Recent"
	};
	_saveFilterInput: any;
	readonly sections = ["waitingForMe", "open", "recent", "closed"];

	constructor(props: Props) {
		super(props);
		this.state = {
			isLoading: props.items.length === 0,
			expanded: {
				waitingForMe: true,
				createdByMe: true,
				open: true,
				closed: true,
				recent: true
			},
			filters: { text: "" },
			q: "",
			displayItems: {},
			totalItems: 0
		};
	}

	componentDidMount() {
		if (this.props.webviewFocused)
			HostApi.instance.track("Page Viewed", { "Page Name": "Reviews" });

		this.applyQuery(this.props.query);
		// if (false && this.props.reviews.length === 0)
		// this.props.fetchReviews().then(() => {
		// 	this.setState({ isLoading: false });
		// });
		// this.disposables.push(
		// 	EventEmitter.subscribe("interaction:active-editor-changed", this.handleFileChangedEvent)
		// );
		// _searchInput might not be necessary if using the autoFocus prop
		// if (this._searchInput) this._searchInput.focus();
	}

	componentDidUpdate(prevProps: Props) {
		if (this.props.query !== prevProps.query || this.props.items !== prevProps.items) {
			console.debug("query or items changed", {
				query: { prev: prevProps.query, current: this.props.query },
				items: { prev: prevProps.items, current: this.props.items }
			});
			this.applyQuery(this.props.query);
		}
	}

	componentWillUnmount() {
		this.disposables.forEach(d => d.dispose());
	}

	toggleSection = (e, section) => {
		e.stopPropagation();
		this.setState({
			expanded: { ...this.state.expanded, [section]: !this.state.expanded[section] }
		});
	};

	renderResultsForSection = results => {
		const { typeFilter } = this.props;
		if (results.length === 0)
			return <div className="no-matches">No {typeFilter}s in this file.</div>;
		else {
			return results.map(a => <SearchResult result={a} query={this.state.filters.text} />);
		}
	};

	renderSection = (section, results) => {
		if (results.length === 0) return null;

		const sectionLabel = this.sectionLabel[section];

		return (
			<>
				<tr>
					<td colSpan={4}>
						<div
							className={createClassString("section", "has-children", {
								expanded: this.state.expanded[section]
							})}
						>
							<div className="header" onClick={e => this.toggleSection(e, section)}>
								<Icon name="chevron-right" className="triangle-right" />
								<span className="clickable">
									{sectionLabel} ({results.length})
								</span>
							</div>
						</div>
					</td>
				</tr>
				{this.state.expanded[section] && this.renderResultsForSection(results)}
			</>
		);
	};

	hasTag = (result, tagFilter) => {
		const { teamTagsArray } = this.props;
		if (tagFilter === "all") return true;

		let resultTags = result.tags || [];
		return resultTags.find(resultTagId => {
			const teamTag = teamTagsArray.find(tag => tag.id === resultTagId);
			return teamTag && (teamTag.label === tagFilter || teamTag.color === tagFilter);
		});
	};

	clickFilter = (e, q) => {
		if (e && e.target && e.target.closest(".gear")) return;
		else this.props.setQuery(q);
	};

	getFilters = (query: string) => {
		const me = this.props.currentUsername.toLowerCase();
		let text = query;
		const filters: AnyObject = {};
		let match;

		if (text.match(/\b(is|status):open\b/)) {
			filters.status = "open";
			text = text.replace(/\s*(is|status):open\s*/, " ");
		}
		if (text.match(/\b(is|status):closed\b/)) {
			filters.status = "closed";
			text = text.replace(/\s*(is|status):closed\s*/, " ");
		}
		if (text.match(/\b(is|type):issue\b/)) {
			filters.type = "issue";
			text = text.replace(/\s*(is|type):issue\s*/, " ");
		}
		if (text.match(/\b(is|type):comment\b/)) {
			filters.type = "comment";
			text = text.replace(/\s*(is|type):comment\s*/, " ");
		}
		if (text.match(/\b(is|type):cr\b/)) {
			filters.type = "review";
			text = text.replace(/\s*(is|type):cr\s*/, " ");
		}
		match = text.match(/\bauthor:@(\S+)(\s|$)/);
		if (match) {
			filters.author = match[1] === "me" ? me : match[1].toLowerCase();
			text = text.replace(/\s*author:@\S+/, " ");
		}
		match = text.match(/\bimpacts:@(\S+)(\s|$)/);
		if (match) {
			filters.impacts = match[1] === "me" ? me : match[1].toLowerCase();
			text = text.replace(/\s*impacts:@\S+/, " ");
		}
		match = text.match(/\bassignee:@(\S+)(\s|$)/);
		if (match) {
			filters.assignee = match[1] === "me" ? me : match[1].toLowerCase();
			text = text.replace(/\s*assignee:@\S+/, " ");
		}
		match = text.match(/\breviewer:@(\S+)[\s|$]/);
		if (match) {
			filters.assignee = match[1] === "me" ? me : match[1].toLowerCase();
			text = text.replace(/\s*reviewer:@\S+/, " ");
		}
		match = text.match(/\btag:\"(.*?)\"(\s|$)/);
		if (match) {
			filters.tag = match[1];
			text = text.replace(/\s*tag:\"(.*?)\"\s*/, " ");
		}
		match = text.match(/\btag:(\S+)(\s|$)/);
		if (match) {
			filters.tag = match[1];
			text = text.replace(/\s*tag:(\S+)\s*/, " ");
		}
		if (text.match(/\bno:tag\b/)) {
			filters.noTag = true;
			text = text.replace(/\s*no:tag\s*/, " ");
		}

		match = text.match(/\bbranch:\"(.*?)\"(\s|$)/);
		if (match) {
			filters.branch = match[1];
			text = text.replace(/\s*branch:\"(.*?)\"\s*/, " ");
		}
		match = text.match(/\bbranch:(\S+)(\s|$)/);
		if (match) {
			filters.branch = match[1];
			text = text.replace(/\s*branch:(\S+)\s*/, " ");
		}

		match = text.match(/\bcommit:\"(.*?)\"(\s|$)/);
		if (match) {
			filters.commit = match[1];
			text = text.replace(/\s*commit:\"(.*?)\"\s*/, " ");
		}
		match = text.match(/\bcommit:(\S+)(\s|$)/);
		if (match) {
			filters.commit = match[1];
			text = text.replace(/\s*commit:(\S+)\s*/, " ");
		}

		match = text.match(/\brepo:\"(.*?)\"(\s|$)/);
		if (match) {
			filters.repo = match[1];
			text = text.replace(/\s*repo:\"(.*?)\"\s*/, " ");
		}
		match = text.match(/\brepo:(\S+)(\s|$)/);
		if (match) {
			filters.repo = match[1];
			text = text.replace(/\s*repo:(\S+)\s*/, " ");
		}

		match = text.match(/\bupdated:([<>]?)(\d\d\d\d)-(\d+)-(\d+)(\s|$)/);
		if (match) {
			const date = new Date(match[2], match[3] - 1, match[4]);
			if (match[1] === "<") filters.updatedBefore = date.getTime();
			if (match[1] === ">") filters.updatedAfter = date.getTime();
			if (!match[1]) filters.updatedOn = date;
			text = text.replace(/\s*updated:[<>]?(\S+)\s*/, " ");
		}
		match = text.match(/\bcreated:([<>]?)(\d\d\d\d)-(\d+)-(\d+)(\s|$)/);
		if (match) {
			const date = new Date(match[2], match[3] - 1, match[4]);
			if (match[1] === "<") filters.createdBefore = date.getTime();
			if (match[1] === ">") filters.createdAfter = date.getTime();
			if (!match[1]) filters.createdOn = date;
			text = text.replace(/\s*created:[<>]?(\S+)\s*/, " ");
		}
		match = text.match(/\bupdated:([<>]?)(\d\d\d\d)-(\d+)-(\d+)(\s|$)/);
		if (match) {
			const date = new Date();
			date.setHours(0, 0, 0, 0);
			if (match[2] === "yesterday") date.setDate(date.getDate() - 1);
			if (match[1] === "<") filters.updatedBefore = date.getTime();
			if (match[1] === ">") filters.updatedAfter = date.getTime();
			if (!match[1]) filters.updatedOn = date;
			text = text.replace(/\s*updated:[<>]?(\S+)\s*/, " ");
		}
		match = text.match(/\bcreated:([<>]?)(yesterday|today)(\s|$)/);
		if (match) {
			const date = new Date();
			date.setHours(0, 0, 0, 0);
			if (match[2] === "yesterday") date.setDate(date.getDate() - 1);
			if (match[1] === "<") filters.createdBefore = date.getTime();
			if (match[1] === ">") filters.createdAfter = date.getTime();
			if (!match[1]) filters.createdOn = date;
			text = text.replace(/\s*created:[<>]?(\S+)\s*/, " ");
		}

		filters.text = text.trim();

		return filters;
	};

	applyQuery = debounce(query => {
		// const sections = ["waitingForMe", "createdByMe", "open", "recent", "closed"];
		let displayItems = {};
		let assignedItems = {};
		let totalItems = 0;

		const assignItem = (item, section) => {
			if (!displayItems[section]) displayItems[section] = [];
			displayItems[section].push(item);
			assignedItems[item.id] = true;
			totalItems++;
		};

		// when the query changes, parse it for different types of
		// filters, and leave behind any non-filters as keywords
		// to search for -- those keywords are left in the `text` variable
		const filters = this.getFilters(query);
		const { usernameMap } = this.props;

		// sort by most recent first
		this.props.items.forEach(item => {
			if (item.deactivated) return null;
			// FIXME author is text, creatorId is an id
			const assignees = (isCSReview(item) ? item.reviewers : item.assignees) || [];
			const creatorUsername = usernameMap[item.creatorId];
			const assigneeUsernames = assignees.map(id => usernameMap[id]);
			const impactedUsernames =
				isCSReview(item) && item.authorsById != null
					? Object.keys(item.authorsById).map(id => usernameMap[id])
					: [];
			if (filters.author && creatorUsername !== filters.author) return null;
			if (filters.impacts && !impactedUsernames.includes(filters.impacts)) return null;
			if (filters.assignee && !assigneeUsernames.includes(filters.assignee)) return null;
			if (filters.status && item.status !== filters.status) return null;
			if (filters.tag && !this.hasTag(item, filters.tag)) return null;
			// FIXME this will only work if we have issues in this query as well
			if (filters.type === "review" && !isCSReview(item)) return null;
			if (filters.type === "issue" && !isCSReview(item) && item.type !== filters.type) return null;
			if (filters.type === "comment" && !isCSReview(item) && item.type !== filters.type)
				return null;
			if (filters.noTag && item.tags && item.tags.length) return null;
			if (filters.branch) {
				if (isCSReview(item)) {
					const branches = (item.reviewChangesets || []).map(changeset => changeset.branch);
					if (!branches.includes(filters.branch)) return null;
				} else {
					const branches = ((item as any).markers || []).map(marker => marker.branchWhenCreated);
					if (!branches.includes(filters.branch)) return null;
				}
			}
			if (filters.commit) {
				if (isCSReview(item)) {
					const commits = ((item.reviewChangesets || []).map(
						changeset => changeset.commits
					) as any).flat(); // we might need to update typescript to get definition for Array.prototype.flat
					const match = commits.find(commit => commit && commit.sha.startsWith(filters.commit));
					if (!match) return null;
				} else {
					const commits = ((item as any).markers || []).map(marker => marker.commitHashWhenCreated);
					const match = commits.find(commit => commit && commit.startsWith(filters.commit));
					if (!match) return null;
				}
			}
			if (filters.repo) {
				if (isCSReview(item)) {
					const repoNames = (item.reviewChangesets || []).map(changeset => {
						const repo = this.props.repos[changeset.repoId];
						if (repo) return repo.name;
						return;
					});
					if (!repoNames.includes(filters.repo)) return null;
				} else {
					const repoNames = ((item as any).markers || []).map(marker => {
						const repo = this.props.repos[marker.repoId];
						if (repo) return repo.name;
						return;
					});
					if (!repoNames.includes(filters.repo)) return null;
				}
			}
			if (filters.updatedAfter && item.modifiedAt < filters.updatedAfter) return null;
			if (filters.updatedBefore && item.modifiedAt > filters.updatedBefore) return null;
			if (filters.updatedOn && !sameDay(new Date(item.modifiedAt), filters.updatedOn)) return null;
			if (filters.createdAfter && item.createdAt < filters.createdAfter) return null;
			if (filters.createdBefore && item.createdAt > filters.createdBefore) return null;
			if (filters.createdOn && !sameDay(new Date(item.createdAt), filters.createdOn)) return null;

			const title = item.title;
			const status = item.status;
			const q = filters.text;

			this.sections.forEach(section => {
				if (assignedItems[item.id]) return;

				if (
					q &&
					!(item.text || "").toLocaleLowerCase().includes(q) &&
					!(title || "").toLocaleLowerCase().includes(q)
				)
					return;
				switch (section) {
					case "waitingForMe":
						if (status === "open" && _includes(assignees || [], this.props.currentUserId))
							assignItem(item, "waitingForMe");
						break;
					// case "createdByMe":
					// if (item.creatorId === currentUserId) assignItem(item, "createdByMe");
					// break;
					case "open":
						if (status === "open") assignItem(item, "open");
						break;
					case "closed":
						if (status === "closed") assignItem(item, "closed");
						break;
					default:
						assignItem(item, "recent");
						break;
				}
			});
			return;
		});

		this.setState({ filters, displayItems, totalItems });
	}, 500);

	saveFilter = () => {
		this.setState({ savingFilter: true });
		setTimeout(() => {
			if (this._saveFilterInput) this._saveFilterInput.focus();
		}, 200);
	};

	saveFilterSubmit = (label, q, index) => {
		if (!q || q.length === 0) return;
		let savedFilters: FilterQuery[] = [];
		if (index == undefined) {
			savedFilters = [...this.props.savedSearchFilters, { label, q }];
		} else {
			savedFilters = [...this.props.savedSearchFilters];
			savedFilters.splice(index, 1, { label, q });
		}

		this.props.setUserPreference(["savedSearchFilters"], [...savedFilters]);
		this.setState({
			savingFilter: false,
			editingFilterIndex: undefined,
			editingFilterLabel: ""
		});
	};

	deleteSavedFilter = index => {
		const savedFilters = [...this.props.savedSearchFilters];
		savedFilters.splice(index, 1);
		this.props.setUserPreference(["savedSearchFilters"], [...savedFilters, { label: "", q: "" }]);
	};

	// this method renders a filter that is in the process of being saved
	renderSaveFilter = (index?: number) => {
		const { editingFilterLabel } = this.state;
		const value = index == undefined ? "" : this.props.savedSearchFilters[index].label;
		const q = index == undefined ? this.props.query : this.props.savedSearchFilters[index].q;
		return (
			<SaveFilter>
				<input
					value={editingFilterLabel}
					autoFocus={true}
					placeholder="Filter name"
					ref={ref => (this._saveFilterInput = ref)}
					className="input-text control"
					type="text"
					onKeyPress={e => {
						if (e.key == "Enter") this.saveFilterSubmit((e.target as any).value, q, index);
					}}
					onChange={e => this.setState({ editingFilterLabel: e.target.value })}
					onBlur={e => this.saveFilterSubmit(e.target.value, q, index)}
				/>
				<Icon name="bookmark" className="bookmark" />
			</SaveFilter>
		);
	};

	editSavedFilter = index => {
		const label = this.props.savedSearchFilters[index].label;
		this.setState({ editingFilterIndex: index, editingFilterLabel: label });
		// FIXME -- focus the damn thing
	};

	render() {
		// if (this.state.isLoading) return null;

		if (false && this.props.noReviewsAtAll) {
			return this.renderBlankFiller();
		}

		const { branchOptions, repoOptions } = this.props;

		const tagMenuItems = this.props.teamTagsArray.map(tag => {
			const color = tag.color.startsWith("#") ? "" : tag.color;
			let className = "tag-menu-block wide";
			if (!tag.color.startsWith("#")) className += " " + tag.color + "-background";
			let label = tag.label || color;
			if (label.match(/\s/)) label = `"${label}"`;
			return {
				label: (
					<span className="tag-menu-selector">
						<span
							className={className}
							style={tag.color.startsWith("#") ? { background: tag.color } : {}}
						>
							{tag.label || <span>&nbsp;</span>}
						</span>
					</span>
				),
				noHover: true,
				searchLabel: tag.label || tag.color,
				action: e => this.props.setQuery(`tag:${label}`)
			};
		});

		const branchMenuItems = branchOptions.map(branch => {
			return {
				label: (
					<span className="branch-menu-selector">
						<Icon name="git-branch" /> {branch}
					</span>
				),
				searchLabel: branch,
				key: branch,
				action: e => this.props.setQuery(`branch:"${branch}"`)
			};
		});

		const repoMenuItems = repoOptions.map(name => {
			return {
				label: (
					<span className="repo-menu-selector">
						<Icon name="repo" /> {name}
					</span>
				),
				searchLabel: name,
				key: name,
				action: e => this.props.setQuery(`repo:"${name}"`)
			};
		});

		// let authorMenuItems = [{ label: "Anyone", action: "all" }, { label: "-" }];
		// authorMenuItems = authorMenuItems.concat(
		// 	Object.values(authorArray)
		// 		// .sort((a, b) => a.fullName )
		// 		.map(author => {
		// 			return {
		// 				label: (
		// 					<span className="branch-menu-selector">
		// 						<Headshot size={18} person={author} />
		// 						{author.name}
		// 					</span>
		// 				),
		// 				searchLabel: author.name,
		// 				action: author.codestreamId || author.id
		// 			};
		// 		})
		// );

		const filterItems = [
			{
				label: "Open Issues and Code Reviews",
				key: "open",
				action: () => this.props.setQuery("is:open")
			},
			{
				label: "Your Issues",
				key: "issues",
				action: () => this.props.setQuery("is:issue author:@me")
			},
			{
				label: "Your Code Reviews",
				key: "reviews",
				action: () => this.props.setQuery("is:cr author:@me ")
			},
			{
				label: "Your Code Comments",
				key: "comments",
				action: () => this.props.setQuery("is:comment author:@me ")
			},
			{
				label: "Everything assigned to you",
				key: "assigned",
				action: () => this.props.setQuery("is:open assignee:@me ")
			},
			{
				label: "Everything mentioning you",
				key: "mine",
				action: () => this.props.setQuery("is:open mentions:@me ")
			},
			{
				label: "Everything impacting code you wrote",
				key: "mycode",
				action: () => this.props.setQuery("impacts:@me ")
			},
			{ label: "By Tag", key: "tag", submenu: tagMenuItems },
			{ label: "By Repo", key: "repo", submenu: repoMenuItems },
			{ label: "By Branch", key: "branch", submenu: branchMenuItems },
			{ label: "-" },
			{
				label: "View advanced search syntax",
				key: "view",
				action: () =>
					HostApi.instance.send(OpenUrlRequestType, {
						url: "https://help.codestream.com/FIXME-URL-IN-ReviewsPanel.js"
					})
			}
		];
		// console.log("FILTERS: ", filters);
		return (
			<div className="panel full-height reviews-panel">
				<PanelHeader title="Filter &amp; Search">
					<SearchBar className="search-bar">
						<FiltersButton items={filterItems}>
							Filters
							<Icon name="chevron-down" />
						</FiltersButton>
						<div className="search-input">
							<Icon name="search" className="search" />
							{this.props.query && (
								<span className="save" onClick={this.saveFilter}>
									<Icon
										name="bookmark"
										className="clickable"
										title="Save custom filter"
										placement="bottomRight"
										align={{ offset: [15, 5] }}
									/>
								</span>
							)}
							<input
								name="q"
								value={this.props.query}
								className="input-text control"
								type="text"
								onChange={e => this.props.setQuery(e.target.value)}
								placeholder="Search all comments, issues and code reviews"
								autoFocus
							/>
						</div>
					</SearchBar>
					{this.props.savedSearchFilters.map((filter, index) => {
						if (index == this.state.editingFilterIndex) return this.renderSaveFilter(index);
						return (
							<SavedFilter onClick={e => this.clickFilter(e, filter.q)}>
								<label>
									<Icon name="bookmark" className="bookmark" /> {filter.label}
								</label>
								<Icon
									name="gear"
									className="gear"
									onClick={e => {
										e.preventDefault();
										this.setState({ filterMenuOpen: index, filterMenuTarget: e.target });
									}}
								/>
								{this.state.filterMenuOpen === index && (
									<Menu
										align="center"
										items={[
											{
												label: "Edit Name",
												key: "edit",
												action: () => this.editSavedFilter(index)
											},
											{
												label: "Delete",
												key: "delete",
												action: () => this.deleteSavedFilter(index)
											}
										]}
										target={this.state.filterMenuTarget}
										action={() => this.setState({ filterMenuOpen: -1 })}
									/>
								)}
							</SavedFilter>
						);
					})}
					{this.state.savingFilter && this.renderSaveFilter()}
				</PanelHeader>
				<ScrollBox>
					<div className="channel-list vscroll" style={{ paddingTop: "10px" }}>
						{this.state.totalItems > 0 && (
							<table style={{ width: "100%", borderCollapse: "collapse" }}>
								<tbody>
									{this.sections.map(section => {
										return this.renderSection(section, this.state.displayItems[section] || []);
									})}
								</tbody>
							</table>
						)}
						{!this.state.totalItems && (
							<div className="no-matches">No results match your search.</div>
						)}
						<ProTip />
					</div>
				</ScrollBox>
			</div>
		);
	}

	renderBlankFiller() {
		return (
			<div className="panel reviews-panel">
				<div className="getting-started">
					<div>
						<p>
							Code Reviews are the building blocks of your team’s process.{" "}
							<a href="https://github.com/TeamCodeStream/CodeStream/wiki/Building-a-Knowledge-Base-with-Codemarks">
								Learn more about how to use code review.
							</a>
						</p>
					</div>
				</div>
			</div>
		);
	}
}

const mapStateToProps = (state: CodeStreamState): ConnectedProps => {
	const { context, session, users, repos } = state;

	const usernameMap = userSelectors.getUsernamesByIdLowerCase(state);

	const teamTagsArray = userSelectors.getTeamTagsArray(state);

	// reviews.forEach(review => {
	// 	const { createdAt, creatorId, reviewChangesets = [] } = review;
	// 	const author = userSelectors.getUserByCsId(users, creatorId);
	// 	if (author) {
	// 		// This breaks one of the rules of redux. In this logic should happen when we need to render name
	// 		// author.name = author.fullName || author.username || author.email;
	// 	}
	// });
	// activity.forEach(item => {
	// 	// FIXME add to repoArray for codemarks
	// });

	return {
		query: context.query || "",
		noReviewsAtAll: !reviewSelectors.teamHasReviews(state),
		usernameMap,
		currentUserId: session.userId!,
		savedSearchFilters: getSavedSearchFilters(state),
		currentUsername: users[session.userId!].username,
		// tagFilter: context.reviewTagFilter,
		authorFilter: "all", // FIXME
		typeFilter: "all", // FIXME
		teamTagsArray,
		// tagFiltersLabelsLower,
		repos,
		// authorFiltersLabelsLower,
		webviewFocused: context.hasFocus
	};
};

export default withSearchableItems(
	connect(mapStateToProps, { setUserPreference, setQuery })(SimpleFilterSearchPanel)
);
