(function () {
  const { TREE_MENU_DATA } = window.SafetyTrainingTreeMenuData;

  function createTreeMenu(options) {
    const state = {
      isOpen: false,
      expandedLevel1: new Set(),
      expandedLevel2: new Set(),
      selectedSettingsSection: "api-proxy",
    };

    const elements = {
      container: null,
      overlay: null,
      menu: null,
      leftPanel: null,
      rightPanel: null,
      settingsContent: null,
    };

    buildDOM();
    bindEvents();

    return {
      open: () => toggleMenu(true),
      close: () => toggleMenu(false),
      toggle: () => toggleMenu(),
      destroy: destroyMenu,
      showSettingsSection: (sectionId) => showSettingsContent(sectionId),
    };

    function buildDOM() {
      elements.overlay = document.createElement("div");
      elements.overlay.className = "tree-menu-overlay is-hidden";

      elements.menu = document.createElement("div");
      elements.menu.className = "tree-menu is-hidden";
      elements.menu.setAttribute("role", "dialog");
      elements.menu.setAttribute("aria-modal", "true");
      elements.menu.setAttribute("aria-labelledby", "treeMenuTitle");

      const header = document.createElement("div");
      header.className = "tree-menu-header";
      header.innerHTML = `
        <h2 id="treeMenuTitle">设置</h2>
        <button class="tree-menu-close" type="button" aria-label="关闭">×</button>
      `;
      elements.menu.appendChild(header);

      const body = document.createElement("div");
      body.className = "tree-menu-body";

      elements.leftPanel = document.createElement("nav");
      elements.leftPanel.className = "tree-menu-left";
      elements.leftPanel.setAttribute("aria-label", "导航");
      elements.leftPanel.appendChild(buildTree(TREE_MENU_DATA));

      elements.rightPanel = document.createElement("div");
      elements.rightPanel.className = "tree-menu-right";
      elements.rightPanel.appendChild(buildEducationPlaceholder());

      body.appendChild(elements.leftPanel);
      body.appendChild(elements.rightPanel);
      elements.menu.appendChild(body);

      elements.container = document.createElement("div");
      elements.container.className = "tree-menu-container";
      elements.container.appendChild(elements.overlay);
      elements.container.appendChild(elements.menu);

      options.targetElement.appendChild(elements.container);
    }

    function buildEducationPlaceholder() {
      const placeholder = document.createElement("div");
      placeholder.className = "tree-menu-placeholder";
      placeholder.innerHTML = `
        <div class="tree-menu-placeholder-icon">📚</div>
        <p>点击左侧「教育内容」展开场景导航</p>
        <p>点击具体场景即可切换并开始练习</p>
      `;
      return placeholder;
    }

    function buildTree(data) {
      const root = document.createElement("ul");
      root.className = "tree-menu-list tree-menu-level-1";

      data.forEach((item) => {
        root.appendChild(buildMenuItem(item, 1));
      });

      return root;
    }

    function buildMenuItem(item, level) {
      const li = document.createElement("li");
      li.className = `tree-menu-item tree-menu-item-level-${level}`;
      li.dataset.itemId = item.id;

      if (item.type === "settings-section") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tree-menu-link tree-menu-settings-section";
        button.textContent = item.title;
        button.dataset.sectionId = item.sectionId;
        button.addEventListener("click", (e) => {
          e.preventDefault();
          showSettingsContent(item.sectionId);
          setActiveSettingsButton(button);
        });
        li.appendChild(button);
      } else if (item.children && item.children.length > 0) {
        const isExpanded = level === 1;
        if (isExpanded) state.expandedLevel1.add(item.id);

        const button = document.createElement("button");
        button.type = "button";
        button.className = `tree-menu-toggle ${isExpanded ? "is-expanded" : ""}`;
        button.setAttribute("aria-expanded", String(isExpanded));
        button.innerHTML = `
          <span class="tree-menu-toggle-icon">${isExpanded ? "▼" : "▶"}</span>
          <span class="tree-menu-toggle-text">${item.title}</span>
        `;
        li.appendChild(button);

        const childList = document.createElement("ul");
        childList.className = `tree-menu-list tree-menu-level-${level + 1} ${isExpanded ? "" : "is-hidden"}`;
        item.children.forEach((child) => {
          childList.appendChild(buildMenuItem(child, level + 1));
        });
        li.appendChild(childList);
      } else {
        const link = document.createElement("a");
        link.className = "tree-menu-link";
        link.textContent = item.title;
        link.dataset.itemType = item.type || "default";
        if (item.url) {
          link.href = item.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        } else {
          link.href = "#";
          link.addEventListener("click", (e) => {
            e.preventDefault();
            handleItemClick(item);
          });
        }
        li.appendChild(link);
      }

      return li;
    }

    function setActiveSettingsButton(activeButton) {
      elements.leftPanel.querySelectorAll(".tree-menu-settings-section").forEach((btn) => {
        btn.classList.remove("is-active");
      });
      activeButton.classList.add("is-active");
    }

    function showSettingsContent(sectionId) {
      elements.rightPanel.innerHTML = "";

      if (sectionId === "education") {
        elements.rightPanel.appendChild(buildEducationPlaceholder());
        return;
      }

      if (options.openSettingsPanel) {
        options.openSettingsPanel(sectionId);
        toggleMenu(false);
      }
    }

    function bindEvents() {
      elements.menu.querySelector(".tree-menu-close").addEventListener("click", () => toggleMenu(false));
      elements.overlay.addEventListener("click", () => toggleMenu(false));

      elements.leftPanel.addEventListener("click", (event) => {
        const toggleButton = event.target.closest(".tree-menu-toggle");
        if (toggleButton) {
          const li = toggleButton.closest(".tree-menu-item");
          const itemId = li.dataset.itemId;
          const level = getLevelFromClass(li.className);
          toggleExpand(itemId, level, toggleButton);
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.isOpen) {
          toggleMenu(false);
        }
      });
    }

    function getLevelFromClass(className) {
      const match = className.match(/tree-menu-item-level-(\d)/);
      return match ? parseInt(match[1], 10) : 1;
    }

    function toggleExpand(itemId, level, button) {
      const li = button.closest(".tree-menu-item");
      const childList = li.querySelector(":scope > ul");
      if (!childList) return;

      const isExpanded = button.classList.contains("is-expanded");
      button.classList.toggle("is-expanded", !isExpanded);
      button.setAttribute("aria-expanded", String(!isExpanded));
      button.querySelector(".tree-menu-toggle-icon").textContent = isExpanded ? "▶" : "▼";
      childList.classList.toggle("is-hidden", isExpanded);

      if (itemId === "education-content" && !isExpanded) {
        showSettingsContent("education");
      }

      if (level === 1) {
        if (isExpanded) state.expandedLevel1.delete(itemId);
        else state.expandedLevel1.add(itemId);
      } else if (level === 2) {
        if (isExpanded) state.expandedLevel2.delete(itemId);
        else state.expandedLevel2.add(itemId);
      }
    }

    function toggleMenu(force) {
      state.isOpen = force !== undefined ? force : !state.isOpen;

      elements.menu.classList.toggle("is-hidden", !state.isOpen);
      elements.overlay.classList.toggle("is-hidden", !state.isOpen);

      if (state.isOpen) {
        elements.menu.querySelector(".tree-menu-close").focus();
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
        options.onClose?.();
      }
    }

    function handleItemClick(item) {
      options.onItemClick?.(item);
      toggleMenu(false);
    }

    function destroyMenu() {
      elements.container?.remove();
      document.body.style.overflow = "";
    }
  }

  window.SafetyTreeMenu = {
    createTreeMenu,
  };
}());